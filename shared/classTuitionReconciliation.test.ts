import { describe, expect, it } from 'vitest';
import {
  isCanonicalTermStart,
  discoverClassCourses,
  resolveCourseTuitionFee,
  toClassReconciliationCourseOption,
  calculateClassTuitionLedger,
  buildClassTuitionReconciliation,
  filterAndSortClassTuitionRows,
  type ClassTuitionClassSource,
  type ClassTuitionEnrollmentSource,
  type ClassTuitionLedgerSource,
  type ClassTuitionStudentSource,
  type ClassReconciliationCourseOption,
  type ClassTuitionCourseSourceKind,
  type ClassTuitionStudentRow,
} from './classTuitionReconciliation';

describe('isCanonicalTermStart', () => {
  it('accepts valid calendar dates formatted as YYYY-MM-DD', () => {
    expect(isCanonicalTermStart('2026-08-14')).toBe(true);
    expect(isCanonicalTermStart('2024-02-29')).toBe(true); // leap year
    expect(isCanonicalTermStart('2000-02-29')).toBe(true); // century leap year
    expect(isCanonicalTermStart('2025-12-31')).toBe(true);
  });

  it('rejects non-existent calendar dates', () => {
    expect(isCanonicalTermStart('2023-02-29')).toBe(false); // non-leap year
    expect(isCanonicalTermStart('2026-02-31')).toBe(false);
    expect(isCanonicalTermStart('2026-04-31')).toBe(false);
    expect(isCanonicalTermStart('2026-13-01')).toBe(false);
    expect(isCanonicalTermStart('2026-00-10')).toBe(false);
  });

  it('rejects invalid padding, datetime strings, and partial dates', () => {
    expect(isCanonicalTermStart('2026-2-3')).toBe(false);
    expect(isCanonicalTermStart('2026-02-3')).toBe(false);
    expect(isCanonicalTermStart('26-02-03')).toBe(false);
    expect(isCanonicalTermStart('2026-02-03T00:00:00Z')).toBe(false);
    expect(isCanonicalTermStart('2026-02-03 00:00:00')).toBe(false);
    expect(isCanonicalTermStart('2026/02/03')).toBe(false);
  });

  it('rejects non-string values and empty strings', () => {
    expect(isCanonicalTermStart('')).toBe(false);
    expect(isCanonicalTermStart(null)).toBe(false);
    expect(isCanonicalTermStart(undefined)).toBe(false);
    expect(isCanonicalTermStart(12345)).toBe(false);
    expect(isCanonicalTermStart({})).toBe(false);
    expect(isCanonicalTermStart([])).toBe(false);
    expect(isCanonicalTermStart(true)).toBe(false);
  });
});

describe('discoverClassCourses', () => {
  const baseClass: ClassTuitionClassSource = {
    id: 'class-1',
    name: 'Tiếng Anh 1A',
    status: 'active',
    teacherId: 't1',
    teacherName: 'Nguyen Van A',
    currentCourseId: 'course-cur',
    startDate: '2026-06-01',
    endDate: '2026-08-31',
    tuitionFee: 2_000_000,
    terms: [
      {
        id: 'term-old',
        name: 'Khóa Xuân 2026',
        startDate: '2026-01-01',
        endDate: '2026-05-31',
        courseId: 'course-old',
        tuitionFee: 1_800_000,
      },
    ],
  };

  it('unions courses from current class, terms, enrollments, and ledgers', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      {
        id: 'enr-1',
        classId: 'class-1',
        studentId: 'st-1',
        termStart: '2025-09-01',
        termEnd: '2025-12-31',
        label: 'Khóa Thu 2025',
        courseId: 'course-enr',
      },
    ];
    const ledgers: ClassTuitionLedgerSource[] = [
      {
        id: 'led-1',
        classId: 'class-1',
        studentId: 'st-1',
        termStart: '2025-05-01',
        termEnd: '2025-08-31',
        termLabel: 'Khóa Hè 2025',
        courseId: 'course-led',
      },
    ];

    const result = discoverClassCourses({
      classSource: baseClass,
      enrollments,
      ledgers,
    });

    expect(result.warnings).toEqual([]);
    expect(result.courses).toHaveLength(4);

    // Current course is first
    expect(result.courses[0]).toMatchObject({
      key: 'class-1:2026-06-01',
      classId: 'class-1',
      termStart: '2026-06-01',
      termEnd: '2026-08-31',
      isCurrent: true,
      sourceKinds: ['class_current'],
    });

    // Historical courses sorted newest to oldest
    expect(result.courses[1].termStart).toBe('2026-01-01');
    expect(result.courses[1].isCurrent).toBe(false);
    expect(result.courses[1].sourceKinds).toEqual(['term_snapshot']);

    expect(result.courses[2].termStart).toBe('2025-09-01');
    expect(result.courses[2].isCurrent).toBe(false);
    expect(result.courses[2].sourceKinds).toEqual(['enrollment']);

    expect(result.courses[3].termStart).toBe('2025-05-01');
    expect(result.courses[3].isCurrent).toBe(false);
    expect(result.courses[3].sourceKinds).toEqual(['ledger']);
  });

  it('unifies same termStart into a single option and sorts sourceKinds in contract order', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      {
        id: 'enr-1',
        classId: 'class-1',
        studentId: 'st-1',
        termStart: '2026-06-01',
        termEnd: '2026-08-31',
        label: 'Khóa Hè 2026',
      },
    ];
    const ledgers: ClassTuitionLedgerSource[] = [
      {
        id: 'led-1',
        classId: 'class-1',
        studentId: 'st-1',
        termStart: '2026-06-01',
      },
    ];

    const result = discoverClassCourses({
      classSource: baseClass,
      enrollments,
      ledgers,
    });

    expect(result.courses).toHaveLength(2);
    const current = result.courses.find((c) => c.termStart === '2026-06-01');
    expect(current).toBeDefined();
    expect(current?.sourceKinds).toEqual(['class_current', 'enrollment', 'ledger']);
    expect(current?.isCurrent).toBe(true);
  });

  it('ignores invalid termStart dates and emits course_term_invalid warning without creating empty course', () => {
    const ledgersWithInvalid: ClassTuitionLedgerSource[] = [
      {
        id: 'led-bad-1',
        classId: 'class-1',
        studentId: 'st-1',
        termStart: '',
      },
      {
        id: 'led-bad-2',
        classId: 'class-1',
        studentId: 'st-2',
        termStart: '2026-02-31',
      },
      {
        id: 'led-bad-3',
        classId: 'class-1',
        studentId: 'st-3',
        termStart: null,
      },
    ];

    const result = discoverClassCourses({
      classSource: {
        ...baseClass,
        startDate: 'invalid-date',
      },
      enrollments: [
        {
          id: 'enr-bad',
          classId: 'class-1',
          termStart: '2026-13-45',
        },
      ],
      ledgers: ledgersWithInvalid,
    });

    expect(result.warnings).toContain('course_term_invalid');
    // Only the valid term '2026-01-01' from terms should exist
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].termStart).toBe('2026-01-01');
    expect(result.courses.every((c) => c.termStart !== '')).toBe(true);
  });

  it('resolves metadata precedence across tiers (current class > term > enrollment > ledger)', () => {
    const classSource: ClassTuitionClassSource = {
      id: 'c1',
      name: 'Class 1',
      status: 'active',
      teacherId: 't1',
      teacherName: 'Nguyen Van A',
      currentCourseId: 'current-course-id',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      terms: [
        {
          id: 'term-1',
          name: 'Term Name 1',
          startDate: '2026-01-01',
          endDate: '2026-04-15',
          courseId: 'term-course-id',
        },
      ],
    };
    const enrollments: ClassTuitionEnrollmentSource[] = [
      {
        id: 'enr-1',
        classId: 'c1',
        termStart: '2026-01-01',
        termEnd: '2026-04-30',
        label: 'Enrollment Label',
        courseId: 'enr-course-id',
      },
    ];
    const ledgers: ClassTuitionLedgerSource[] = [
      {
        id: 'led-1',
        classId: 'c1',
        termStart: '2026-01-01',
        termEnd: '2026-05-01',
        termLabel: 'Ledger Label',
        courseId: 'led-course-id',
      },
    ];

    const result = discoverClassCourses({ classSource, enrollments, ledgers });
    expect(result.courses).toHaveLength(1);
    const course = result.courses[0];

    // Precedence: current class provides courseId and termEnd; term provides label (current class has no term name)
    expect(course.courseId).toBe('current-course-id');
    expect(course.termEnd).toBe('2026-03-31');
    expect(course.label).toBe('Term Name 1');
    expect(course.warnings).toContain('course_metadata_conflict');
  });

  it('breaks ties within same tier by sorting doc IDs ascending and generates course_metadata_conflict', () => {
    const classSource: ClassTuitionClassSource = {
      id: 'c1',
      name: 'Class 1',
      status: 'active',
      teacherId: 't1',
      teacherName: 'Nguyen Van A',
      terms: [],
    };
    const enrollments: ClassTuitionEnrollmentSource[] = [
      {
        id: 'enr-z',
        classId: 'c1',
        termStart: '2026-01-01',
        label: 'Label Z',
        termEnd: '2026-04-30',
        courseId: 'course-z',
      },
      {
        id: 'enr-a',
        classId: 'c1',
        termStart: '2026-01-01',
        label: 'Label A',
        termEnd: '2026-04-15',
        courseId: 'course-a',
      },
    ];

    const result = discoverClassCourses({ classSource, enrollments, ledgers: [] });
    expect(result.courses).toHaveLength(1);
    const course = result.courses[0];

    // 'enr-a' sorted before 'enr-z'
    expect(course.label).toBe('Label A');
    expect(course.termEnd).toBe('2026-04-15');
    expect(course.courseId).toBe('course-a');
    expect(course.warnings).toContain('course_metadata_conflict');
  });
});

describe('resolveCourseTuitionFee & toClassReconciliationCourseOption', () => {
  const baseClass: ClassTuitionClassSource = {
    id: 'c1',
    name: 'Class 1',
    status: 'active',
    teacherId: 't1',
    teacherName: 'Nguyen Van A',
    currentCourseId: 'cur-id',
    startDate: '2026-06-01',
    tuitionFee: 2_500_000,
    terms: [
      {
        id: 't-old-1',
        name: 'Term Old 1',
        startDate: '2026-01-01',
        endDate: '2026-05-31',
        tuitionFee: 2_200_000,
      },
      {
        id: 't-old-free',
        name: 'Term Free',
        startDate: '2025-09-01',
        endDate: '2025-12-31',
        tuitionFee: 0,
      },
      {
        id: 't-old-nofee',
        name: 'Term No Fee',
        startDate: '2025-05-01',
        endDate: '2025-08-31',
      },
    ],
  };

  it('resolves current course fee from class.tuitionFee', () => {
    const course = {
      key: 'c1:2026-06-01',
      classId: 'c1',
      courseId: 'cur-id',
      termStart: '2026-06-01',
      termEnd: null,
      label: 'Khóa Hiện Tại',
      isCurrent: true,
      sourceKinds: ['class_current'] as ClassTuitionCourseSourceKind[],
      warnings: [],
    };

    const fee = resolveCourseTuitionFee({
      classSource: baseClass,
      course,
      ledgers: [],
    });

    expect(fee).toEqual({ amount: 2_500_000, source: 'class_current' });
  });

  it('resolves historical term fee from term.tuitionFee (including 0) and NEVER uses class current fee', () => {
    const courseWithFee = {
      key: 'c1:2026-01-01',
      classId: 'c1',
      courseId: null,
      termStart: '2026-01-01',
      termEnd: null,
      label: 'Term Old 1',
      isCurrent: false,
      sourceKinds: ['term_snapshot'] as ClassTuitionCourseSourceKind[],
      warnings: [],
    };
    expect(resolveCourseTuitionFee({ classSource: baseClass, course: courseWithFee, ledgers: [] })).toEqual({
      amount: 2_200_000,
      source: 'term_snapshot',
    });

    const courseFree = {
      key: 'c1:2025-09-01',
      classId: 'c1',
      courseId: null,
      termStart: '2025-09-01',
      termEnd: null,
      label: 'Term Free',
      isCurrent: false,
      sourceKinds: ['term_snapshot'] as ClassTuitionCourseSourceKind[],
      warnings: [],
    };
    expect(resolveCourseTuitionFee({ classSource: baseClass, course: courseFree, ledgers: [] })).toEqual({
      amount: 0,
      source: 'term_snapshot',
    });
  });

  it('infers fee from ledgers when single positive amount exists', () => {
    const course = {
      key: 'c1:2025-05-01',
      classId: 'c1',
      courseId: null,
      termStart: '2025-05-01',
      termEnd: null,
      label: 'Term No Fee',
      isCurrent: false,
      sourceKinds: ['term_snapshot', 'ledger'] as ClassTuitionCourseSourceKind[],
      warnings: [],
    };
    const ledgers: ClassTuitionLedgerSource[] = [
      { id: 'l1', classId: 'c1', termStart: '2025-05-01', amount: 1_900_000 },
      { id: 'l2', classId: 'c1', termStart: '2025-05-01', amount: 1_900_000 },
      { id: 'l3', classId: 'c1', termStart: '2025-05-01', amount: 0 }, // 0 ignored in ledger inference
      { id: 'l4', classId: 'c1', termStart: '2025-05-01', amount: -500 }, // negative ignored
    ];

    expect(resolveCourseTuitionFee({ classSource: baseClass, course, ledgers })).toEqual({
      amount: 1_900_000,
      source: 'inferred_from_ledgers',
    });
  });

  it('returns unknown when no valid positive ledger amounts exist', () => {
    const course = {
      key: 'c1:2025-05-01',
      classId: 'c1',
      courseId: null,
      termStart: '2025-05-01',
      termEnd: null,
      label: 'Term No Fee',
      isCurrent: false,
      sourceKinds: ['term_snapshot'] as ClassTuitionCourseSourceKind[],
      warnings: [],
    };
    expect(resolveCourseTuitionFee({ classSource: baseClass, course, ledgers: [] })).toEqual({
      amount: null,
      source: 'unknown',
    });
  });

  it('returns conflict when multiple distinct positive ledger amounts exist', () => {
    const course = {
      key: 'c1:2025-05-01',
      classId: 'c1',
      courseId: null,
      termStart: '2025-05-01',
      termEnd: null,
      label: 'Term No Fee',
      isCurrent: false,
      sourceKinds: ['term_snapshot', 'ledger'] as ClassTuitionCourseSourceKind[],
      warnings: [],
    };
    const ledgers: ClassTuitionLedgerSource[] = [
      { id: 'l1', classId: 'c1', termStart: '2025-05-01', amount: 1_900_000 },
      { id: 'l2', classId: 'c1', termStart: '2025-05-01', amount: 2_000_000 },
    ];
    expect(resolveCourseTuitionFee({ classSource: baseClass, course, ledgers })).toEqual({
      amount: null,
      source: 'conflict',
    });
  });

  it('toClassReconciliationCourseOption strips classId/sourceKinds and includes fee metadata', () => {
    const course = {
      key: 'c1:2026-06-01',
      classId: 'c1',
      courseId: 'cur-id',
      termStart: '2026-06-01',
      termEnd: '2026-08-31',
      label: 'Khóa Hiện Tại',
      isCurrent: true,
      sourceKinds: ['class_current', 'ledger'] as ('class_current' | 'ledger')[],
      warnings: [],
    };
    const option = toClassReconciliationCourseOption(course, {
      amount: 2_500_000,
      source: 'class_current',
    });

    expect(option).toEqual({
      key: 'c1:2026-06-01',
      courseId: 'cur-id',
      termStart: '2026-06-01',
      termEnd: '2026-08-31',
      label: 'Khóa Hiện Tại',
      isCurrent: true,
      warnings: [],
      tuitionFee: 2_500_000,
      tuitionFeeSource: 'class_current',
    });
    expect((option as unknown as { classId?: string }).classId).toBeUndefined();
    expect((option as unknown as { sourceKinds?: unknown }).sourceKinds).toBeUndefined();
  });
});

describe('calculateClassTuitionLedger', () => {
  it('calculates standard financial metrics correctly', () => {
    const ledger: ClassTuitionLedgerSource = {
      id: 'l1',
      amount: 2_000_000,
      discountTotal: 200_000,
      paidTotal: 1_000_000,
    };
    const metrics = calculateClassTuitionLedger(ledger);
    expect(metrics).toEqual({
      gross: 2_000_000,
      reduction: 200_000,
      netDue: 1_800_000,
      paid: 1_000_000,
      outstanding: 800_000,
      overpaid: 0,
      warnings: [],
    });
  });

  it('handles overpaid without capping paid', () => {
    const ledger: ClassTuitionLedgerSource = {
      id: 'l1',
      amount: 2_000_000,
      discountTotal: 500_000,
      paidTotal: 2_500_000,
    };
    const metrics = calculateClassTuitionLedger(ledger);
    expect(metrics).toEqual({
      gross: 2_000_000,
      reduction: 500_000,
      netDue: 1_500_000,
      paid: 2_500_000,
      outstanding: 0,
      overpaid: 1_000_000,
      warnings: ['overpaid'],
    });
  });

  it('handles discount exceeding gross with netDue clamping to 0', () => {
    const ledger: ClassTuitionLedgerSource = {
      id: 'l1',
      amount: 1_000_000,
      discountTotal: 1_500_000,
      paidTotal: 0,
    };
    const metrics = calculateClassTuitionLedger(ledger);
    expect(metrics).toEqual({
      gross: 1_000_000,
      reduction: 1_500_000,
      netDue: 0,
      paid: 0,
      outstanding: 0,
      overpaid: 0,
      warnings: [],
    });
  });

  it('propagates null and emits specific warnings when fields are invalid or missing', () => {
    // amount invalid
    const badAmount = calculateClassTuitionLedger({
      id: 'l-bad-1',
      amount: -100,
      discountTotal: 50_000,
      paidTotal: 200_000,
    });
    expect(badAmount.gross).toBeNull();
    expect(badAmount.reduction).toBe(50_000);
    expect(badAmount.netDue).toBeNull();
    expect(badAmount.paid).toBe(200_000);
    expect(badAmount.outstanding).toBeNull();
    expect(badAmount.overpaid).toBeNull();
    expect(badAmount.warnings).toContain('ledger_amount_invalid');

    // discount invalid
    const badDiscount = calculateClassTuitionLedger({
      id: 'l-bad-2',
      amount: 1_000_000,
      discountTotal: 'NaN',
      paidTotal: 200_000,
    });
    expect(badDiscount.gross).toBe(1_000_000);
    expect(badDiscount.reduction).toBeNull();
    expect(badDiscount.netDue).toBeNull();
    expect(badDiscount.paid).toBe(200_000);
    expect(badDiscount.outstanding).toBeNull();
    expect(badDiscount.overpaid).toBeNull();
    expect(badDiscount.warnings).toContain('ledger_discount_invalid');

    // paid invalid
    const badPaid = calculateClassTuitionLedger({
      id: 'l-bad-3',
      amount: 1_000_000,
      discountTotal: 0,
      paidTotal: null,
    });
    expect(badPaid.gross).toBe(1_000_000);
    expect(badPaid.reduction).toBe(0);
    expect(badPaid.netDue).toBe(1_000_000);
    expect(badPaid.paid).toBeNull();
    expect(badPaid.outstanding).toBeNull();
    expect(badPaid.overpaid).toBeNull();
    expect(badPaid.warnings).toContain('ledger_paid_invalid');
  });
});

describe('buildClassTuitionReconciliation roster', () => {
  const courseOption: ClassReconciliationCourseOption = {
    key: 'c1:2026-06-01',
    courseId: 'course-1',
    termStart: '2026-06-01',
    termEnd: '2026-08-31',
    label: 'Khóa Hè 2026',
    isCurrent: true,
    tuitionFee: 2_000_000,
    tuitionFeeSource: 'class_current',
    warnings: [],
  };

  const students: ClassTuitionStudentSource[] = [
    { id: 'st-1', fullName: 'Nguyễn Văn A', studentCode: 'HV001' },
    { id: 'st-2', fullName: 'Trần Thị B', studentCode: 'HV002' },
    { id: 'st-3', fullName: 'Lê Văn C', studentCode: 'HV003' },
  ];

  it('creates union roster: enrollment without ledger and ledger without enrollment', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      { id: 'e1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', status: 'active' },
    ];
    const ledgers: ClassTuitionLedgerSource[] = [
      { id: 'l1', studentId: 'st-2', classId: 'c1', termStart: '2026-06-01', amount: 2_000_000, discountTotal: 0, paidTotal: 2_000_000 },
    ];

    const result = buildClassTuitionReconciliation({
      classId: 'c1',
      className: 'Class 1',
      course: courseOption,
      enrollments,
      ledgers,
      students,
    });

    expect(result.rows).toHaveLength(2);

    const row1 = result.rows.find((r) => r.studentId === 'st-1');
    expect(row1).toBeDefined();
    expect(row1?.chargeable).toBe(true);
    expect(row1?.expectedGross).toBe(2_000_000);
    expect(row1?.recordedGross).toBe(0);
    expect(row1?.warnings).toContain('missing_ledger');

    const row2 = result.rows.find((r) => r.studentId === 'st-2');
    expect(row2).toBeDefined();
    expect(row2?.chargeable).toBe(true);
    expect(row2?.expectedGross).toBe(2_000_000);
    expect(row2?.recordedGross).toBe(2_000_000);
    expect(row2?.warnings).toContain('ledger_without_enrollment');
  });

  it('marks missing student doc with student_record_missing without losing studentId from roster', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      { id: 'e1', studentId: 'st-ghost', classId: 'c1', termStart: '2026-06-01', status: 'active' },
    ];

    const result = buildClassTuitionReconciliation({
      classId: 'c1',
      className: 'Class 1',
      course: courseOption,
      enrollments,
      ledgers: [],
      students, // st-ghost not in students
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.studentId).toBe('st-ghost');
    expect(row.studentRecordFound).toBe(false);
    expect(row.warnings).toContain('student_record_missing');
  });

  it('creates individual orphan_ledger row for each ledger missing studentId', () => {
    const ledgers: ClassTuitionLedgerSource[] = [
      { id: 'l-orphan-1', classId: 'c1', termStart: '2026-06-01', studentId: null, amount: 1_000_000, discountTotal: 0, paidTotal: 500_000 },
      { id: 'l-orphan-2', classId: 'c1', termStart: '2026-06-01', studentId: '', amount: 800_000, discountTotal: 0, paidTotal: 800_000 },
    ];

    const result = buildClassTuitionReconciliation({
      classId: 'c1',
      className: 'Class 1',
      course: courseOption,
      enrollments: [],
      ledgers,
      students,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].kind).toBe('orphan_ledger');
    expect(result.rows[0].studentId).toBeNull();
    expect(result.rows[0].chargeable).toBe(false);
    expect(result.rows[0].expectedGross).toBeNull();
    expect(result.rows[0].warnings).toContain('ledger_student_missing');
    expect(result.rows[0].recordedGross).toBe(1_000_000);

    expect(result.rows[1].kind).toBe('orphan_ledger');
    expect(result.rows[1].warnings).toContain('ledger_student_missing');
    expect(result.rows[1].recordedGross).toBe(800_000);
  });

  it('handles duplicate enrollments and duplicate ledgers correctly', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      { id: 'e1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', status: 'active' },
      { id: 'e2', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', status: 'transferred' },
    ];
    const ledgers: ClassTuitionLedgerSource[] = [
      { id: 'l1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', amount: 2_000_000, discountTotal: 100_000, paidTotal: 1_000_000 },
      { id: 'l2', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', amount: 2_000_000, discountTotal: 0, paidTotal: 500_000 },
    ];

    const result = buildClassTuitionReconciliation({
      classId: 'c1',
      className: 'Class 1',
      course: courseOption,
      enrollments,
      ledgers,
      students,
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.warnings).toContain('duplicate_enrollment');
    expect(row.warnings).toContain('duplicate_ledger');
    expect(row.chargeable).toBe(true);
    expect(row.expectedGross).toBe(2_000_000); // 1 expected fee
    expect(row.recordedGross).toBe(4_000_000); // sum of both ledgers
    expect(row.reductionTotal).toBe(100_000);
    expect(row.netDueTotal).toBe(3_900_000);
    expect(row.paidTotal).toBe(1_500_000);
    expect(row.outstandingTotal).toBe(2_400_000);
  });

  it('determines chargeable status correctly for transferred / dropped vs active statuses', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      { id: 'e-drop', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', status: 'dropped' },
      { id: 'e-trial', studentId: 'st-2', classId: 'c1', termStart: '2026-06-01', status: 'trial' },
    ];

    const result = buildClassTuitionReconciliation({
      classId: 'c1',
      className: 'Class 1',
      course: courseOption,
      enrollments,
      ledgers: [],
      students,
    });

    const dropRow = result.rows.find((r) => r.studentId === 'st-1');
    expect(dropRow?.chargeable).toBe(false);
    expect(dropRow?.expectedGross).toBeNull();
    expect(dropRow?.warnings).toContain('tuition_review_required');
    expect(dropRow?.warnings).not.toContain('missing_ledger');

    const trialRow = result.rows.find((r) => r.studentId === 'st-2');
    expect(trialRow?.chargeable).toBe(true);
    expect(trialRow?.expectedGross).toBe(2_000_000);
    expect(trialRow?.warnings).toContain('missing_ledger');
  });

  it('emits ledger_fee_mismatch when ledger amount differs from resolved snapshot fee', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      { id: 'e1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', status: 'active' },
    ];
    const ledgers: ClassTuitionLedgerSource[] = [
      { id: 'l1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', amount: 1_500_000, discountTotal: 0, paidTotal: 1_500_000 },
    ];

    const result = buildClassTuitionReconciliation({
      classId: 'c1',
      className: 'Class 1',
      course: courseOption, // fee is 2_000_000
      enrollments,
      ledgers,
      students,
    });

    const row = result.rows[0];
    expect(row.warnings).toContain('ledger_fee_mismatch');
    expect(row.recordedGross).toBe(1_500_000);
    expect(row.expectedGross).toBe(2_000_000);
  });
});

describe('buildClassTuitionReconciliation summary', () => {
  const courseOption: ClassReconciliationCourseOption = {
    key: 'c1:2026-06-01',
    courseId: 'course-1',
    termStart: '2026-06-01',
    termEnd: '2026-08-31',
    label: 'Khóa Hè 2026',
    isCurrent: true,
    tuitionFee: 2_000_000,
    tuitionFeeSource: 'class_current',
    warnings: [],
  };

  const students: ClassTuitionStudentSource[] = [
    { id: 'st-1', fullName: 'Nguyễn Văn A', studentCode: 'HV001' },
    { id: 'st-2', fullName: 'Trần Thị B', studentCode: 'HV002' },
  ];

  it('computes summary totals and counts correctly', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      { id: 'e1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', status: 'active' },
      { id: 'e2', studentId: 'st-2', classId: 'c1', termStart: '2026-06-01', status: 'active' },
    ];
    const ledgers: ClassTuitionLedgerSource[] = [
      { id: 'l1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', amount: 2_000_000, discountTotal: 200_000, paidTotal: 2_200_000 },
      // st-2 has missing ledger
      // orphan ledger
      { id: 'l-orphan', studentId: null, classId: 'c1', termStart: '2026-06-01', amount: 500_000, discountTotal: 0, paidTotal: 500_000 },
    ];

    const result = buildClassTuitionReconciliation({
      classId: 'c1',
      className: 'Class 1',
      course: courseOption,
      enrollments,
      ledgers,
      students,
    });

    expect(result.summary).toEqual({
      expectedGross: 4_000_000, // 2 chargeable students * 2_000_000
      recordedGross: 2_500_000, // 2_000_000 (st-1) + 0 (st-2) + 500_000 (orphan)
      reductionTotal: 200_000,
      netDueTotal: 2_300_000,
      paidTotal: 2_700_000,
      outstandingTotal: 0,
      overpaidTotal: 400_000, // st-1 netDue 1_800_000, paid 2_200_000 -> overpaid 400_000
      studentCount: 2,
      unidentifiedLedgerCount: 1,
      missingLedgerCount: 1,
      warningRowCount: 3, // st-1 (overpaid), st-2 (missing_ledger), orphan (ledger_student_missing)
    });
  });

  it('keeps independent metric totals when one field is invalid and does not mask valid metrics', () => {
    const enrollments: ClassTuitionEnrollmentSource[] = [
      { id: 'e1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', status: 'active' },
    ];
    const ledgers: ClassTuitionLedgerSource[] = [
      { id: 'l1', studentId: 'st-1', classId: 'c1', termStart: '2026-06-01', amount: -100, discountTotal: 0, paidTotal: 1_500_000 },
    ];

    const result = buildClassTuitionReconciliation({
      classId: 'c1',
      className: 'Class 1',
      course: courseOption,
      enrollments,
      ledgers,
      students,
    });

    // recordedGross is null due to bad amount, but paidTotal is valid 1_500_000
    expect(result.summary.recordedGross).toBeNull();
    expect(result.summary.netDueTotal).toBeNull();
    expect(result.summary.outstandingTotal).toBeNull();
    expect(result.summary.paidTotal).toBe(1_500_000);
    expect(result.summary.expectedGross).toBe(2_000_000);
  });
});

describe('filterAndSortClassTuitionRows', () => {
  const rows: ClassTuitionStudentRow[] = [
    {
      key: 'st-1',
      kind: 'student',
      studentId: 'st-1',
      fullName: 'Trần Văn Bình',
      studentCode: 'HV002',
      studentRecordFound: true,
      enrollmentIds: ['e1'],
      enrollmentStatuses: ['active'],
      ledgerIds: ['l1'],
      chargeable: true,
      expectedGross: 2_000_000,
      recordedGross: 2_000_000,
      reductionTotal: 0,
      netDueTotal: 2_000_000,
      paidTotal: 1_000_000,
      outstandingTotal: 1_000_000,
      overpaidTotal: 0,
      warnings: [],
    },
    {
      key: 'st-2',
      kind: 'student',
      studentId: 'st-2',
      fullName: 'An Hoàng',
      studentCode: 'HV001',
      studentRecordFound: true,
      enrollmentIds: ['e2'],
      enrollmentStatuses: ['active'],
      ledgerIds: ['l2'],
      chargeable: true,
      expectedGross: 2_000_000,
      recordedGross: 2_000_000,
      reductionTotal: 0,
      netDueTotal: 2_000_000,
      paidTotal: 2_000_000,
      outstandingTotal: 0,
      overpaidTotal: 0,
      warnings: [],
    },
    {
      key: 'st-3',
      kind: 'student',
      studentId: 'st-3',
      fullName: 'Nguyễn Cường',
      studentCode: 'HV003',
      studentRecordFound: true,
      enrollmentIds: ['e3'],
      enrollmentStatuses: ['active'],
      ledgerIds: [],
      chargeable: true,
      expectedGross: 2_000_000,
      recordedGross: 0,
      reductionTotal: 0,
      netDueTotal: 0,
      paidTotal: 0,
      outstandingTotal: 0,
      overpaidTotal: 0,
      warnings: ['missing_ledger'],
    },
    {
      key: 'st-4',
      kind: 'student',
      studentId: 'st-4',
      fullName: 'Đoàn Dũng',
      studentCode: 'HV004',
      studentRecordFound: true,
      enrollmentIds: ['e4'],
      enrollmentStatuses: ['active'],
      ledgerIds: ['l4'],
      chargeable: true,
      expectedGross: 2_000_000,
      recordedGross: null,
      reductionTotal: 0,
      netDueTotal: null,
      paidTotal: 500_000,
      outstandingTotal: null,
      overpaidTotal: null,
      warnings: ['ledger_amount_invalid'],
    },
  ];

  it('filters by search term (name or student code, accent-insensitive)', () => {
    const res1 = filterAndSortClassTuitionRows(rows, { search: 'binh', filter: 'all' });
    expect(res1).toHaveLength(1);
    expect(res1[0].studentId).toBe('st-1');

    const res2 = filterAndSortClassTuitionRows(rows, { search: 'hv001', filter: 'all' });
    expect(res2).toHaveLength(1);
    expect(res2[0].studentId).toBe('st-2');
  });

  it('filters by status: outstanding, paid, missing_ledger, warnings', () => {
    const outstanding = filterAndSortClassTuitionRows(rows, { search: '', filter: 'outstanding' });
    expect(outstanding.map((r) => r.studentId)).toEqual(['st-1']);

    const paid = filterAndSortClassTuitionRows(rows, { search: '', filter: 'paid' });
    expect(paid.map((r) => r.studentId)).toEqual(['st-2']);

    const missing = filterAndSortClassTuitionRows(rows, { search: '', filter: 'missing_ledger' });
    expect(missing.map((r) => r.studentId)).toEqual(['st-3']);

    const withWarnings = filterAndSortClassTuitionRows(rows, { search: '', filter: 'warnings' });
    expect(withWarnings.map((r) => r.studentId).sort()).toEqual(['st-3', 'st-4']);
  });

  it('sorts rows by: warnings first -> outstanding descending -> null outstanding last -> name ascending -> key', () => {
    const sorted = filterAndSortClassTuitionRows(rows, { search: '', filter: 'all' });

    // st-3 and st-4 have warnings -> should be first
    // between st-3 (outstanding 0) and st-4 (outstanding null): st-3 outstanding 0 > null
    expect(sorted[0].studentId).toBe('st-3');
    expect(sorted[1].studentId).toBe('st-4');

    // non-warning rows: st-1 (outstanding 1M) > st-2 (outstanding 0)
    expect(sorted[2].studentId).toBe('st-1');
    expect(sorted[3].studentId).toBe('st-2');
  });
});
