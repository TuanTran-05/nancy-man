export type MoneyMetric = number | null;

export type ClassTuitionWarningCode =
  | 'missing_ledger'
  | 'duplicate_ledger'
  | 'duplicate_enrollment'
  | 'ledger_without_enrollment'
  | 'tuition_review_required'
  | 'course_fee_unknown'
  | 'course_fee_conflict'
  | 'ledger_fee_mismatch'
  | 'course_term_invalid'
  | 'course_metadata_conflict'
  | 'overpaid'
  | 'student_record_missing'
  | 'ledger_student_missing'
  | 'enrollment_data_invalid'
  | 'ledger_amount_invalid'
  | 'ledger_discount_invalid'
  | 'ledger_paid_invalid';

export type ClassTuitionFeeSource =
  | 'class_current'
  | 'term_snapshot'
  | 'inferred_from_ledgers'
  | 'unknown'
  | 'conflict';

export type ClassTuitionEnrollmentStatus =
  | 'trial'
  | 'active'
  | 'on_leave'
  | 'completed'
  | 'transferred'
  | 'dropped';

export type ClassTuitionStudentRow = {
  key: string;
  kind: 'student' | 'orphan_ledger';
  studentId: string | null;
  fullName: string;
  studentCode: string;
  studentRecordFound: boolean;
  enrollmentIds: string[];
  enrollmentStatuses: ClassTuitionEnrollmentStatus[];
  ledgerIds: string[];
  chargeable: boolean;
  expectedGross: MoneyMetric;
  recordedGross: MoneyMetric;
  reductionTotal: MoneyMetric;
  netDueTotal: MoneyMetric;
  paidTotal: MoneyMetric;
  outstandingTotal: MoneyMetric;
  overpaidTotal: MoneyMetric;
  warnings: ClassTuitionWarningCode[];
};

export type ClassTuitionClassStatus = 'active' | 'paused' | 'archived';

export type ClassTuitionCourseSourceKind =
  | 'class_current'
  | 'term_snapshot'
  | 'enrollment'
  | 'ledger';

export type ClassTuitionTermSource = {
  id: string;
  name: string;
  startDate: unknown;
  endDate: unknown;
  courseId?: unknown;
  tuitionFee?: unknown;
};

export type ClassTuitionClassSource = {
  id: string;
  name: string;
  status: ClassTuitionClassStatus;
  /** Empty string when the class has no teacher assigned. */
  teacherId: string;
  /** Resolved from the users collection; empty when the teacher doc is gone. */
  teacherName: string;
  currentCourseId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  tuitionFee?: unknown;
  terms: ClassTuitionTermSource[];
};

export type ClassTuitionEnrollmentSource = {
  id: string;
  classId?: unknown;
  studentId?: unknown;
  courseId?: unknown;
  termStart?: unknown;
  termEnd?: unknown;
  label?: unknown;
  status?: unknown;
  joinedAt?: unknown;
  endedAt?: unknown;
};

export type ClassTuitionLedgerSource = {
  id: string;
  classId?: unknown;
  studentId?: unknown;
  courseId?: unknown;
  termStart?: unknown;
  termEnd?: unknown;
  termLabel?: unknown;
  amount?: unknown;
  discountTotal?: unknown;
  paidTotal?: unknown;
};

export type ClassTuitionStudentSource = {
  id: string;
  fullName: string;
  studentCode: string;
};

export type ClassTuitionReceiptAllocationSource = {
  ledgerId?: unknown;
  classId?: unknown;
  amount?: unknown;
  discountAmount?: unknown;
  discountType?: unknown;
};

export type ClassTuitionReceiptSource = {
  id: string;
  receiptNo?: unknown;
  studentId?: unknown;
  classId?: unknown;
  classIds?: unknown;
  ledgerId?: unknown;
  amountReceived?: unknown;
  discountAmount?: unknown;
  discountType?: unknown;
  paymentMethod?: unknown;
  receivedDate?: unknown;
  note?: unknown;
  walletDeposit?: unknown;
  status?: unknown;
  allocations?: unknown;
};

export type DiscoveredClassTuitionCourse = {
  key: string;
  classId: string;
  courseId: string | null;
  termStart: string;
  termEnd: string | null;
  label: string;
  isCurrent: boolean;
  sourceKinds: ClassTuitionCourseSourceKind[];
  warnings: ClassTuitionWarningCode[];
};

export type ClassReconciliationCourseOption = Omit<
  DiscoveredClassTuitionCourse,
  'classId' | 'sourceKinds'
> & {
  tuitionFee: number | null;
  tuitionFeeSource: ClassTuitionFeeSource;
};

export type ClassReconciliationClassOption = {
  id: string;
  name: string;
  status: ClassTuitionClassStatus;
  teacherId: string;
  teacherName: string;
};

export type ClassReconciliationOptionsResponse =
  | {
      success: true;
      mode: 'classes';
      classes: ClassReconciliationClassOption[];
    }
  | {
      success: true;
      mode: 'courses';
      selectedClass: ClassReconciliationClassOption;
      warnings: ClassTuitionWarningCode[];
      courses: ClassReconciliationCourseOption[];
    };

export type ClassTuitionLedgerMetrics = {
  gross: MoneyMetric;
  reduction: MoneyMetric;
  netDue: MoneyMetric;
  paid: MoneyMetric;
  outstanding: MoneyMetric;
  overpaid: MoneyMetric;
  warnings: ClassTuitionWarningCode[];
};

export type ClassTuitionReconciliationResponse = {
  success: true;
  scope: {
    classId: string;
    className: string;
    courseId: string | null;
    termStart: string;
    termEnd: string | null;
    courseLabel: string;
  };
  tuitionFee: { amount: number | null; source: ClassTuitionFeeSource };
  summary: {
    expectedGross: MoneyMetric;
    recordedGross: MoneyMetric;
    reductionTotal: MoneyMetric;
    netDueTotal: MoneyMetric;
    paidTotal: MoneyMetric;
    outstandingTotal: MoneyMetric;
    overpaidTotal: MoneyMetric;
    studentCount: number;
    unidentifiedLedgerCount: number;
    missingLedgerCount: number;
    warningRowCount: number;
  };
  rows: ClassTuitionStudentRow[];
  warnings: ClassTuitionWarningCode[];
};

export type ClassTuitionStudentDetailResponse = {
  success: true;
  scope: {
    classId: string;
    termStart: string;
    studentId: string | null;
    ledgerId: string | null;
  };
  student: {
    id: string | null;
    fullName: string;
    studentCode: string;
    recordFound: boolean;
  };
  enrollments: Array<{
    id: string;
    status: ClassTuitionEnrollmentStatus;
    joinedAt: string;
    endedAt: string | null;
  }>;
  ledgers: Array<{
    id: string;
    gross: MoneyMetric;
    reduction: MoneyMetric;
    netDue: MoneyMetric;
    paid: MoneyMetric;
    outstanding: MoneyMetric;
    overpaid: MoneyMetric;
  }>;
  allocations: Array<{
    receiptId: string;
    receiptNo: string;
    receivedDate: string;
    paymentMethod: string;
    allocatedAmount: number;
    discountAmount: number;
    discountType: string | null;
    note: string;
  }>;
  warnings: ClassTuitionWarningCode[];
  workspaceUrl: string | null;
};

/**
 * Validates whether a value is a canonical date string formatted as YYYY-MM-DD.
 * Uses round-trip UTC calendar validation.
 */
export function isCanonicalTermStart(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parts = value.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

const SOURCE_KIND_ORDER: Record<ClassTuitionCourseSourceKind, number> = {
  class_current: 1,
  term_snapshot: 2,
  enrollment: 3,
  ledger: 4,
};

type MetadataCandidate<T> = {
  tier: number;
  id: string;
  value: T;
};

function resolveMetadata<T extends string>(
  candidates: MetadataCandidate<T>[],
  defaultValue: T | null
): { value: T | null; hasConflict: boolean } {
  const nonNull = candidates.filter((c) => c.value !== null && c.value !== undefined && c.value !== '');
  if (nonNull.length === 0) {
    return { value: defaultValue, hasConflict: false };
  }

  const distinctValues = new Set(nonNull.map((c) => c.value));
  const hasConflict = distinctValues.size > 1;

  nonNull.sort((a, b) => {
    if (a.tier !== b.tier) {
      return a.tier - b.tier;
    }
    return a.id.localeCompare(b.id);
  });

  return { value: nonNull[0].value, hasConflict };
}

export function discoverClassCourses(input: {
  classSource: ClassTuitionClassSource;
  enrollments: ClassTuitionEnrollmentSource[];
  ledgers: ClassTuitionLedgerSource[];
}): {
  courses: DiscoveredClassTuitionCourse[];
  warnings: ClassTuitionWarningCode[];
} {
  const { classSource, enrollments = [], ledgers = [] } = input;
  const topWarnings = new Set<ClassTuitionWarningCode>();

  // Check invalid date formats
  if (classSource.startDate !== undefined && classSource.startDate !== null && !isCanonicalTermStart(classSource.startDate)) {
    topWarnings.add('course_term_invalid');
  }

  if (Array.isArray(classSource.terms)) {
    for (const term of classSource.terms) {
      if (term.startDate !== undefined && term.startDate !== null && !isCanonicalTermStart(term.startDate)) {
        topWarnings.add('course_term_invalid');
      }
    }
  }

  for (const enr of enrollments) {
    if (enr.termStart !== undefined && enr.termStart !== null && !isCanonicalTermStart(enr.termStart)) {
      topWarnings.add('course_term_invalid');
    }
  }

  for (const led of ledgers) {
    if (led.termStart !== undefined && led.termStart !== null && !isCanonicalTermStart(led.termStart)) {
      topWarnings.add('course_term_invalid');
    }
  }

  // Map courses by canonical termStart
  type CourseAccumulator = {
    termStart: string;
    isCurrent: boolean;
    sourceKinds: Set<ClassTuitionCourseSourceKind>;
    courseIdCandidates: MetadataCandidate<string>[];
    termEndCandidates: MetadataCandidate<string>[];
    labelCandidates: MetadataCandidate<string>[];
  };

  const courseMap = new Map<string, CourseAccumulator>();

  const getOrCreate = (termStart: string): CourseAccumulator => {
    let entry = courseMap.get(termStart);
    if (!entry) {
      entry = {
        termStart,
        isCurrent: false,
        sourceKinds: new Set<ClassTuitionCourseSourceKind>(),
        courseIdCandidates: [],
        termEndCandidates: [],
        labelCandidates: [],
      };
      courseMap.set(termStart, entry);
    }
    return entry;
  };

  // 1. Current class
  if (isCanonicalTermStart(classSource.startDate)) {
    const termStart = classSource.startDate;
    const acc = getOrCreate(termStart);
    acc.isCurrent = true;
    acc.sourceKinds.add('class_current');
    if (typeof classSource.currentCourseId === 'string' && classSource.currentCourseId.trim() !== '') {
      acc.courseIdCandidates.push({
        tier: SOURCE_KIND_ORDER.class_current,
        id: classSource.id,
        value: classSource.currentCourseId.trim(),
      });
    }
    if (typeof classSource.endDate === 'string' && classSource.endDate.trim() !== '') {
      acc.termEndCandidates.push({
        tier: SOURCE_KIND_ORDER.class_current,
        id: classSource.id,
        value: classSource.endDate.trim(),
      });
    }
  }

  // 2. ClassTerm snapshots
  if (Array.isArray(classSource.terms)) {
    for (const term of classSource.terms) {
      if (isCanonicalTermStart(term.startDate)) {
        const acc = getOrCreate(term.startDate);
        acc.sourceKinds.add('term_snapshot');
        if (typeof term.courseId === 'string' && term.courseId.trim() !== '') {
          acc.courseIdCandidates.push({
            tier: SOURCE_KIND_ORDER.term_snapshot,
            id: term.id,
            value: term.courseId.trim(),
          });
        }
        if (typeof term.endDate === 'string' && term.endDate.trim() !== '') {
          acc.termEndCandidates.push({
            tier: SOURCE_KIND_ORDER.term_snapshot,
            id: term.id,
            value: term.endDate.trim(),
          });
        }
        if (typeof term.name === 'string' && term.name.trim() !== '') {
          acc.labelCandidates.push({
            tier: SOURCE_KIND_ORDER.term_snapshot,
            id: term.id,
            value: term.name.trim(),
          });
        }
      }
    }
  }

  // 3. Enrollments
  for (const enr of enrollments) {
    if (isCanonicalTermStart(enr.termStart)) {
      const acc = getOrCreate(enr.termStart);
      acc.sourceKinds.add('enrollment');
      if (typeof enr.courseId === 'string' && enr.courseId.trim() !== '') {
        acc.courseIdCandidates.push({
          tier: SOURCE_KIND_ORDER.enrollment,
          id: enr.id,
          value: enr.courseId.trim(),
        });
      }
      if (typeof enr.termEnd === 'string' && enr.termEnd.trim() !== '') {
        acc.termEndCandidates.push({
          tier: SOURCE_KIND_ORDER.enrollment,
          id: enr.id,
          value: enr.termEnd.trim(),
        });
      }
      if (typeof enr.label === 'string' && enr.label.trim() !== '') {
        acc.labelCandidates.push({
          tier: SOURCE_KIND_ORDER.enrollment,
          id: enr.id,
          value: enr.label.trim(),
        });
      }
    }
  }

  // 4. Ledgers
  for (const led of ledgers) {
    if (isCanonicalTermStart(led.termStart)) {
      const acc = getOrCreate(led.termStart);
      acc.sourceKinds.add('ledger');
      if (typeof led.courseId === 'string' && led.courseId.trim() !== '') {
        acc.courseIdCandidates.push({
          tier: SOURCE_KIND_ORDER.ledger,
          id: led.id,
          value: led.courseId.trim(),
        });
      }
      if (typeof led.termEnd === 'string' && led.termEnd.trim() !== '') {
        acc.termEndCandidates.push({
          tier: SOURCE_KIND_ORDER.ledger,
          id: led.id,
          value: led.termEnd.trim(),
        });
      }
      if (typeof led.termLabel === 'string' && led.termLabel.trim() !== '') {
        acc.labelCandidates.push({
          tier: SOURCE_KIND_ORDER.ledger,
          id: led.id,
          value: led.termLabel.trim(),
        });
      }
    }
  }

  const courses: DiscoveredClassTuitionCourse[] = [];

  for (const acc of courseMap.values()) {
    const courseWarnings = new Set<ClassTuitionWarningCode>();

    const courseIdRes = resolveMetadata(acc.courseIdCandidates, null);
    const termEndRes = resolveMetadata(acc.termEndCandidates, null);
    const labelRes = resolveMetadata(acc.labelCandidates, acc.termStart);

    if (courseIdRes.hasConflict || termEndRes.hasConflict || labelRes.hasConflict) {
      courseWarnings.add('course_metadata_conflict');
    }

    const sortedSourceKinds = Array.from(acc.sourceKinds).sort(
      (a, b) => SOURCE_KIND_ORDER[a] - SOURCE_KIND_ORDER[b]
    );

    courses.push({
      key: `${classSource.id}:${acc.termStart}`,
      classId: classSource.id,
      courseId: courseIdRes.value,
      termStart: acc.termStart,
      termEnd: termEndRes.value,
      label: labelRes.value || acc.termStart,
      isCurrent: acc.isCurrent,
      sourceKinds: sortedSourceKinds,
      warnings: Array.from(courseWarnings),
    });
  }

  // Sort courses: current first, then historical newest to oldest
  courses.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1;
    }
    return b.termStart.localeCompare(a.termStart);
  });

  return {
    courses,
    warnings: Array.from(topWarnings),
  };
}

export function resolveCourseTuitionFee(input: {
  classSource: ClassTuitionClassSource;
  course: DiscoveredClassTuitionCourse;
  ledgers: ClassTuitionLedgerSource[];
}): { amount: number | null; source: ClassTuitionFeeSource } {
  const { classSource, course, ledgers = [] } = input;

  // 1. Current class fee if course is current
  if (
    course.isCurrent &&
    course.sourceKinds.includes('class_current') &&
    isCanonicalTermStart(classSource.startDate) &&
    classSource.startDate === course.termStart
  ) {
    if (
      typeof classSource.tuitionFee === 'number' &&
      Number.isFinite(classSource.tuitionFee) &&
      classSource.tuitionFee >= 0
    ) {
      return { amount: classSource.tuitionFee, source: 'class_current' };
    }
  }

  // 2. ClassTerm snapshot fee if matching term exists
  if (Array.isArray(classSource.terms)) {
    const matchingTerm = classSource.terms.find(
      (t) =>
        isCanonicalTermStart(t.startDate) &&
        t.startDate === course.termStart &&
        typeof t.tuitionFee === 'number' &&
        Number.isFinite(t.tuitionFee) &&
        t.tuitionFee >= 0
    );
    if (matchingTerm && typeof matchingTerm.tuitionFee === 'number') {
      return { amount: matchingTerm.tuitionFee, source: 'term_snapshot' };
    }
  }

  // 3. Inferred from ledgers belonging to this course
  const courseLedgers = ledgers.filter(
    (l) => isCanonicalTermStart(l.termStart) && l.termStart === course.termStart
  );
  const positiveAmounts = new Set<number>();
  for (const l of courseLedgers) {
    if (
      typeof l.amount === 'number' &&
      Number.isFinite(l.amount) &&
      l.amount > 0
    ) {
      positiveAmounts.add(l.amount);
    }
  }

  if (positiveAmounts.size === 1) {
    const [amount] = Array.from(positiveAmounts);
    return { amount, source: 'inferred_from_ledgers' };
  } else if (positiveAmounts.size > 1) {
    return { amount: null, source: 'conflict' };
  } else {
    return { amount: null, source: 'unknown' };
  }
}

export function toClassReconciliationCourseOption(
  course: DiscoveredClassTuitionCourse,
  tuitionFee: { amount: number | null; source: ClassTuitionFeeSource }
): ClassReconciliationCourseOption {
  return {
    key: course.key,
    courseId: course.courseId,
    termStart: course.termStart,
    termEnd: course.termEnd,
    label: course.label,
    isCurrent: course.isCurrent,
    warnings: [...course.warnings],
    tuitionFee: tuitionFee.amount,
    tuitionFeeSource: tuitionFee.source,
  };
}

function isValidMoney(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

export function calculateClassTuitionLedger(
  ledger: ClassTuitionLedgerSource
): ClassTuitionLedgerMetrics {
  const warnings: ClassTuitionWarningCode[] = [];

  const gross = isValidMoney(ledger.amount) ? ledger.amount : null;
  if (!isValidMoney(ledger.amount)) {
    warnings.push('ledger_amount_invalid');
  }

  const reduction = isValidMoney(ledger.discountTotal)
    ? ledger.discountTotal
    : null;
  if (!isValidMoney(ledger.discountTotal)) {
    warnings.push('ledger_discount_invalid');
  }

  const netDue =
    gross === null || reduction === null
      ? null
      : Math.max(gross - reduction, 0);

  const paid = isValidMoney(ledger.paidTotal) ? ledger.paidTotal : null;
  if (!isValidMoney(ledger.paidTotal)) {
    warnings.push('ledger_paid_invalid');
  }

  const outstanding =
    netDue === null || paid === null ? null : Math.max(netDue - paid, 0);

  const overpaid =
    netDue === null || paid === null ? null : Math.max(paid - netDue, 0);

  if (overpaid !== null && overpaid > 0) {
    warnings.push('overpaid');
  }

  return {
    gross,
    reduction,
    netDue,
    paid,
    outstanding,
    overpaid,
    warnings,
  };
}

const VALID_ENROLLMENT_STATUSES = new Set<ClassTuitionEnrollmentStatus>([
  'trial',
  'active',
  'on_leave',
  'completed',
  'transferred',
  'dropped',
]);

const CHARGEABLE_STATUSES = new Set<ClassTuitionEnrollmentStatus>([
  'trial',
  'active',
  'on_leave',
  'completed',
]);

export function buildClassTuitionReconciliation(input: {
  classId: string;
  className: string;
  course: ClassReconciliationCourseOption;
  enrollments: ClassTuitionEnrollmentSource[];
  ledgers: ClassTuitionLedgerSource[];
  students: ClassTuitionStudentSource[];
}): ClassTuitionReconciliationResponse {
  const { classId, className, course, enrollments = [], ledgers = [], students = [] } = input;

  const scopedEnrollments = enrollments.filter(
    (e) => isCanonicalTermStart(e.termStart) && e.termStart === course.termStart
  );
  const scopedLedgers = ledgers.filter(
    (l) => isCanonicalTermStart(l.termStart) && l.termStart === course.termStart
  );

  const rows: ClassTuitionStudentRow[] = [];

  // Group ledgers into orphan ledgers vs student ledgers
  const orphanLedgers: ClassTuitionLedgerSource[] = [];
  const studentLedgersMap = new Map<string, ClassTuitionLedgerSource[]>();

  for (const l of scopedLedgers) {
    if (typeof l.studentId !== 'string' || l.studentId.trim() === '') {
      orphanLedgers.push(l);
    } else {
      const sId = l.studentId.trim();
      let arr = studentLedgersMap.get(sId);
      if (!arr) {
        arr = [];
        studentLedgersMap.set(sId, arr);
      }
      arr.push(l);
    }
  }

  // Group enrollments by student
  const studentEnrollmentsMap = new Map<string, ClassTuitionEnrollmentSource[]>();
  for (const e of scopedEnrollments) {
    if (typeof e.studentId === 'string' && e.studentId.trim() !== '') {
      const sId = e.studentId.trim();
      let arr = studentEnrollmentsMap.get(sId);
      if (!arr) {
        arr = [];
        studentEnrollmentsMap.set(sId, arr);
      }
      arr.push(e);
    }
  }

  // 1. Process orphan ledgers
  for (const orphan of orphanLedgers) {
    const metrics = calculateClassTuitionLedger(orphan);
    const rowWarnings = new Set<ClassTuitionWarningCode>(metrics.warnings);
    rowWarnings.add('ledger_student_missing');

    rows.push({
      key: `orphan:${orphan.id}`,
      kind: 'orphan_ledger',
      studentId: null,
      fullName: '',
      studentCode: '',
      studentRecordFound: false,
      enrollmentIds: [],
      enrollmentStatuses: [],
      ledgerIds: [orphan.id],
      chargeable: false,
      expectedGross: null,
      recordedGross: metrics.gross,
      reductionTotal: metrics.reduction,
      netDueTotal: metrics.netDue,
      paidTotal: metrics.paid,
      outstandingTotal: metrics.outstanding,
      overpaidTotal: metrics.overpaid,
      warnings: Array.from(rowWarnings),
    });
  }

  // 2. Process student union
  const allStudentIds = new Set<string>([
    ...studentEnrollmentsMap.keys(),
    ...studentLedgersMap.keys(),
  ]);

  for (const sId of allStudentIds) {
    const rowWarnings = new Set<ClassTuitionWarningCode>();
    const studentDoc = students.find((s) => s.id === sId);
    const studentRecordFound = !!studentDoc;
    if (!studentRecordFound) {
      rowWarnings.add('student_record_missing');
    }

    const stEnrollments = studentEnrollmentsMap.get(sId) || [];
    const stLedgers = studentLedgersMap.get(sId) || [];

    if (stEnrollments.length > 1) {
      rowWarnings.add('duplicate_enrollment');
    }
    if (stLedgers.length > 1) {
      rowWarnings.add('duplicate_ledger');
    }

    const enrollmentStatuses: ClassTuitionEnrollmentStatus[] = [];
    for (const e of stEnrollments) {
      if (
        typeof e.status === 'string' &&
        VALID_ENROLLMENT_STATUSES.has(e.status as ClassTuitionEnrollmentStatus)
      ) {
        enrollmentStatuses.push(e.status as ClassTuitionEnrollmentStatus);
      } else {
        rowWarnings.add('enrollment_data_invalid');
        enrollmentStatuses.push('active');
      }
    }

    const enrollmentIds = stEnrollments.map((e) => e.id).sort();
    const ledgerIds = stLedgers.map((l) => l.id).sort();

    let chargeable: boolean;
    let expectedGross: MoneyMetric;
    let recordedGross: MoneyMetric = 0;
    let reductionTotal: MoneyMetric = 0;
    let netDueTotal: MoneyMetric = 0;
    let paidTotal: MoneyMetric = 0;
    let outstandingTotal: MoneyMetric = 0;
    let overpaidTotal: MoneyMetric = 0;

    if (stLedgers.length === 0) {
      const isChargeableStatus = enrollmentStatuses.some((st) =>
        CHARGEABLE_STATUSES.has(st)
      );

      if (isChargeableStatus) {
        chargeable = true;
        rowWarnings.add('missing_ledger');
        expectedGross = course.tuitionFee !== null ? course.tuitionFee : null;
        if (course.tuitionFee === null) {
          if (course.tuitionFeeSource === 'conflict') {
            rowWarnings.add('course_fee_conflict');
          } else {
            rowWarnings.add('course_fee_unknown');
          }
        }
      } else {
        chargeable = false;
        rowWarnings.add('tuition_review_required');
        expectedGross = null;
      }
    } else {
      chargeable = true;
      expectedGross = course.tuitionFee !== null ? course.tuitionFee : null;
      if (stEnrollments.length === 0) {
        rowWarnings.add('ledger_without_enrollment');
      }
      if (course.tuitionFee === null) {
        if (course.tuitionFeeSource === 'conflict') {
          rowWarnings.add('course_fee_conflict');
        } else {
          rowWarnings.add('course_fee_unknown');
        }
      }

      let hasGrossNull = false;
      let hasReductionNull = false;
      let hasNetDueNull = false;
      let hasPaidNull = false;
      let sumGross = 0;
      let sumReduction = 0;
      let sumNetDue = 0;
      let sumPaid = 0;

      for (const l of stLedgers) {
        const metrics = calculateClassTuitionLedger(l);
        for (const w of metrics.warnings) {
          rowWarnings.add(w);
        }

        if (
          course.tuitionFee !== null &&
          isValidMoney(l.amount) &&
          l.amount !== course.tuitionFee
        ) {
          rowWarnings.add('ledger_fee_mismatch');
        }

        if (metrics.gross === null) hasGrossNull = true;
        else sumGross += metrics.gross;

        if (metrics.reduction === null) hasReductionNull = true;
        else sumReduction += metrics.reduction;

        if (metrics.netDue === null) hasNetDueNull = true;
        else sumNetDue += metrics.netDue;

        if (metrics.paid === null) hasPaidNull = true;
        else sumPaid += metrics.paid;
      }

      recordedGross = hasGrossNull ? null : sumGross;
      reductionTotal = hasReductionNull ? null : sumReduction;
      netDueTotal = hasNetDueNull ? null : sumNetDue;
      paidTotal = hasPaidNull ? null : sumPaid;

      if (netDueTotal === null || paidTotal === null) {
        outstandingTotal = null;
        overpaidTotal = null;
      } else {
        outstandingTotal = Math.max(netDueTotal - paidTotal, 0);
        overpaidTotal = Math.max(paidTotal - netDueTotal, 0);
      }

      if (overpaidTotal !== null && overpaidTotal > 0) {
        rowWarnings.add('overpaid');
      }
    }

    rows.push({
      key: sId,
      kind: 'student',
      studentId: sId,
      fullName: studentDoc?.fullName || '',
      studentCode: studentDoc?.studentCode || '',
      studentRecordFound,
      enrollmentIds,
      enrollmentStatuses,
      ledgerIds,
      chargeable,
      expectedGross,
      recordedGross,
      reductionTotal,
      netDueTotal,
      paidTotal,
      outstandingTotal,
      overpaidTotal,
      warnings: Array.from(rowWarnings),
    });
  }

  // Summary
  const studentRows = rows.filter((r) => r.kind === 'student');
  const chargeableStudents = studentRows.filter((r) => r.chargeable);

  const expectedGross =
    course.tuitionFee !== null
      ? course.tuitionFee * chargeableStudents.length
      : null;

  const recordedGross = rows.some((r) => r.recordedGross === null)
    ? null
    : rows.reduce((acc, r) => acc + (r.recordedGross ?? 0), 0);

  const reductionTotal = rows.some((r) => r.reductionTotal === null)
    ? null
    : rows.reduce((acc, r) => acc + (r.reductionTotal ?? 0), 0);

  const netDueTotal = rows.some((r) => r.netDueTotal === null)
    ? null
    : rows.reduce((acc, r) => acc + (r.netDueTotal ?? 0), 0);

  const paidTotal = rows.some((r) => r.paidTotal === null)
    ? null
    : rows.reduce((acc, r) => acc + (r.paidTotal ?? 0), 0);

  const outstandingTotal = rows.some((r) => r.outstandingTotal === null)
    ? null
    : rows.reduce((acc, r) => acc + (r.outstandingTotal ?? 0), 0);

  const overpaidTotal = rows.some((r) => r.overpaidTotal === null)
    ? null
    : rows.reduce((acc, r) => acc + (r.overpaidTotal ?? 0), 0);

  const studentCount = studentRows.length;
  const unidentifiedLedgerCount = rows.filter((r) => r.kind === 'orphan_ledger').length;
  const missingLedgerCount = rows.filter((r) => r.warnings.includes('missing_ledger')).length;
  const warningRowCount = rows.filter((r) => r.warnings.length > 0).length;

  return {
    success: true,
    scope: {
      classId,
      className,
      courseId: course.courseId,
      termStart: course.termStart,
      termEnd: course.termEnd,
      courseLabel: course.label,
    },
    tuitionFee: {
      amount: course.tuitionFee,
      source: course.tuitionFeeSource,
    },
    summary: {
      expectedGross,
      recordedGross,
      reductionTotal,
      netDueTotal,
      paidTotal,
      outstandingTotal,
      overpaidTotal,
      studentCount,
      unidentifiedLedgerCount,
      missingLedgerCount,
      warningRowCount,
    },
    rows,
    warnings: [...course.warnings],
  };
}

export type ClassTuitionRowFilter =
  | 'all'
  | 'outstanding'
  | 'paid'
  | 'missing_ledger'
  | 'warnings';

function normalizeVietnamese(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function filterAndSortClassTuitionRows(
  rows: ClassTuitionStudentRow[],
  input: { search: string; filter: ClassTuitionRowFilter }
): ClassTuitionStudentRow[] {
  const { search, filter } = input;
  const normSearch = search.trim() !== '' ? normalizeVietnamese(search.trim()) : null;

  let filtered = rows;

  if (normSearch) {
    filtered = filtered.filter((r) => {
      const matchName = normalizeVietnamese(r.fullName).includes(normSearch);
      const matchCode = normalizeVietnamese(r.studentCode).includes(normSearch);
      const matchKey = normalizeVietnamese(r.key).includes(normSearch);
      const matchLedger = r.ledgerIds.some((lid) =>
        normalizeVietnamese(lid).includes(normSearch)
      );
      return matchName || matchCode || matchKey || matchLedger;
    });
  }

  if (filter === 'outstanding') {
    filtered = filtered.filter(
      (r) => r.outstandingTotal !== null && r.outstandingTotal > 0
    );
  } else if (filter === 'paid') {
    filtered = filtered.filter(
      (r) =>
        r.ledgerIds.length > 0 &&
        r.outstandingTotal === 0 &&
        r.netDueTotal !== null
    );
  } else if (filter === 'missing_ledger') {
    filtered = filtered.filter((r) => r.warnings.includes('missing_ledger'));
  } else if (filter === 'warnings') {
    filtered = filtered.filter((r) => r.warnings.length > 0);
  }

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    // 1. Warnings first
    const aWarn = a.warnings.length > 0 ? 1 : 0;
    const bWarn = b.warnings.length > 0 ? 1 : 0;
    if (aWarn !== bWarn) {
      return bWarn - aWarn;
    }

    // 2. Outstanding descending, nulls last
    if (a.outstandingTotal !== b.outstandingTotal) {
      if (a.outstandingTotal === null) return 1;
      if (b.outstandingTotal === null) return -1;
      return b.outstandingTotal - a.outstandingTotal;
    }

    // 3. Name ascending
    const nameCmp = a.fullName.localeCompare(b.fullName, 'vi', { sensitivity: 'base' });
    if (nameCmp !== 0) return nameCmp;

    // 4. Key ascending
    return a.key.localeCompare(b.key);
  });

  return sorted;
}
