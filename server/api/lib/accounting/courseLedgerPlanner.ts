import {
  isOpenStudentCourseEnrollmentStatus,
  type StudentCourseEnrollmentStatus,
} from '../../../../shared/studentCourseEnrollment.js';
import {
  buildCourseLedgerId,
  courseLedgerTupleKey,
  indexLedgersByTuple,
  type TupleIndexedLedger,
} from './courseLedgerIdentity.js';

export type PlannedLedger = {
  ledgerId: string;
  studentId: string;
  enrollmentId: string;
  termStart: string;
  termEnd: string | null;
  amount: number;
};

export type ClassLedgerSkipReason =
  | 'class_not_found'
  | 'class_archived'
  | 'tuition_not_configured';

export type ClassLedgerPlan = {
  classId: string;
  className: string;
  tuitionFee: number;
  skipReason: ClassLedgerSkipReason | null;
  creates: PlannedLedger[];
  alreadyExists: number;
  duplicates: Array<{ studentId: string; termStart: string; ledgerIds: string[] }>;
};

export type PlannerEnrollment = {
  id: string;
  studentId: string;
  classId: string;
  termStart: string;
  termEnd: string | null;
  status: StudentCourseEnrollmentStatus;
};

export function planClassLedgers(input: {
  classId: string;
  classData: Record<string, unknown> | null;
  enrollments: PlannerEnrollment[];
  ledgers: TupleIndexedLedger[];
}): ClassLedgerPlan {
  const { classId, classData } = input;

  // Indexing runs before the class gates on purpose: an archived or unpriced
  // class can still carry duplicates created before it was archived, and the
  // duplicate report is a whole-center audit.
  const index = indexLedgersByTuple(classId, input.ledgers);
  const duplicates = [...index.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([key, bucket]) => {
      const [studentId, , termStart] = key.split('|');
      return { studentId, termStart, ledgerIds: bucket.map((ledger) => ledger.id) };
    });

  const className = String(classData?.name || '');
  const tuitionFee = Number(classData?.tuitionFee || 0);

  const skipReason: ClassLedgerSkipReason | null = !classData
    ? 'class_not_found'
    : classData.status === 'archived'
      ? 'class_archived'
      : !Number.isFinite(tuitionFee) || tuitionFee <= 0
        ? 'tuition_not_configured'
        : null;

  if (skipReason) {
    return { classId, className, tuitionFee, skipReason, creates: [], alreadyExists: 0, duplicates };
  }

  // Tuples planned in this pass, so two enrollment rows sharing a tuple
  // cannot both produce a ledger.
  const planned = new Set<string>();
  const creates: PlannedLedger[] = [];
  let alreadyExists = 0;

  for (const enrollment of input.enrollments) {
    if (!isOpenStudentCourseEnrollmentStatus(enrollment.status)) continue;
    const key = courseLedgerTupleKey(enrollment.studentId, classId, enrollment.termStart);
    if (index.has(key) || planned.has(key)) {
      alreadyExists += 1;
      continue;
    }
    planned.add(key);
    creates.push({
      ledgerId: buildCourseLedgerId(
        enrollment.studentId,
        classId,
        enrollment.termStart,
        enrollment.termEnd || ''
      ),
      studentId: enrollment.studentId,
      enrollmentId: enrollment.id,
      termStart: enrollment.termStart,
      termEnd: enrollment.termEnd,
      amount: tuitionFee,
    });
  }

  return { classId, className, tuitionFee, skipReason: null, creates, alreadyExists, duplicates };
}
