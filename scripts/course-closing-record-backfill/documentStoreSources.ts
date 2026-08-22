import type { DocumentStore } from '@/server/db/documentStore.js';
import type { CourseClosingRecord } from '../../shared/courseClosingRecords.js';
import type { BackfillSourceBundle, BackfillSourceDoc } from './types.js';

const CLASS_FIELDS = [
  'classId',
  'name',
  'className',
  'startDate',
  'courseStartDate',
  'endDate',
  'courseEndDate',
  'currentCourseId',
  'courseId',
  'teacherId',
  'teacherName',
  'tuitionFee',
  'fee',
  'tuitionDueDate',
  'schedule',
  'daysOfWeek',
  'holidays',
  'grade',
  'level',
  'terms',
  'courseClosing',
] as const;

const STUDENT_FIELDS = [
  'classId',
  'courseId',
  'currentCourseId',
  'name',
  'studentName',
  'studentId',
  'code',
  'studentCode',
  'teacherId',
  'enrollmentStatus',
  'studentLifecycle',
] as const;

const EVALUATION_FIELDS = [
  'classId',
  'courseId',
  'studentId',
  'evaluationType',
  'date',
  'createdAt',
  'updatedAt',
  'termId',
  'termStart',
  'termEnd',
  'courseEndDate',
  'scores',
  'finalScore',
  'totalScore',
  'rank',
  'positivePoints',
  'improvementPoints',
] as const;

const NOTIFICATION_FIELDS = [
  'classId',
  'courseId',
  'studentId',
  'type',
  'status',
  'createdAt',
  'date',
  'noticeDate',
  'termId',
  'termStart',
  'termEnd',
  'courseEndDate',
  'nextCourseStartDate',
  'nextCourseEndDate',
  'evaluationId',
  'evaluationVersion',
  'ledgerId',
  'tuitionAmount',
  'amount',
  'schoolFee',
  'paymentDueDate',
  'tuitionDueDate',
  'dueDate',
] as const;

const LEDGER_FIELDS = [
  'classId',
  'courseId',
  'studentId',
  'termStart',
  'termEnd',
  'courseEndDate',
  'nextCourseStartDate',
  'nextCourseEndDate',
  'noticeDate',
  'amount',
  'tuitionAmount',
  'paymentDueDate',
  'tuitionDueDate',
  'dueDate',
  'status',
  'tuitionNoticeCount',
  'tuitionNoticeLastSentAt',
  'tuitionNoticeLastAmount',
  'tuitionNoticeLastDueDate',
  'createdAt',
  'updatedAt',
] as const;

const ENROLLMENT_FIELDS = [
  'studentId',
  'classId',
  'termStart',
  'termEnd',
  'status',
  'joinedAt',
  'endedAt',
  'source',
  'confidence',
] as const;

const USER_FIELDS = ['displayName', 'name'] as const;

export interface BackfillSourceLoadSummary {
  classes: number;
  students: number;
  evaluations: number;
  notifications: number;
  ledgers: number;
  enrollments: number;
  users: number;
  existingRecords: number;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString()
      : String(value);
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        normalizeValue(child),
      ])
    );
  }
  return value;
}

function projectData(
  data: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((field) => data[field] !== undefined)
      .map((field) => [field, normalizeValue(data[field])])
  );
}

function updateTimeOf(doc: { updateTime?: { toDate?: () => Date } }): string | undefined {
  const date = doc.updateTime?.toDate?.();
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

async function loadProjectedCollection(
  db: DocumentStore,
  collectionName: string,
  fields: readonly string[],
  includeUpdateTime = false
): Promise<BackfillSourceDoc[]> {
  const snapshot = await db
    .collection(collectionName)
    .select(...fields)
    .get();
  return snapshot.docs.map((doc) => {
    const updateTime = includeUpdateTime ? updateTimeOf(doc) : undefined;
    return {
      id: doc.id,
      data: projectData((doc.data() || {}) as Record<string, unknown>, fields),
      ...(updateTime ? { updateTime } : {}),
    };
  });
}

export async function loadCourseClosingBackfillSources(db: DocumentStore): Promise<{
  sources: BackfillSourceBundle;
  summary: BackfillSourceLoadSummary;
}> {
  const [
    classes,
    students,
    evaluations,
    notifications,
    ledgers,
    enrollments,
    users,
    existingSnapshot,
  ] = await Promise.all([
    loadProjectedCollection(db, 'classes', CLASS_FIELDS),
    loadProjectedCollection(db, 'students', STUDENT_FIELDS),
    loadProjectedCollection(db, 'evaluations', EVALUATION_FIELDS, true),
    loadProjectedCollection(db, 'zalo_notifications', NOTIFICATION_FIELDS),
    loadProjectedCollection(db, 'course_fee_ledgers', LEDGER_FIELDS),
    loadProjectedCollection(db, 'student_course_enrollments', ENROLLMENT_FIELDS),
    loadProjectedCollection(db, 'users', USER_FIELDS),
    db.collection('course_closing_records').get(),
  ]);

  const existingRecords = existingSnapshot.docs.map(
    (doc) => ({ ...(doc.data() as CourseClosingRecord), id: doc.id }) as CourseClosingRecord
  );
  const existingRecordVersions = Object.fromEntries(
    existingSnapshot.docs
      .map((doc) => [doc.id, updateTimeOf(doc)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );
  const sources: BackfillSourceBundle = {
    classes,
    students,
    evaluations,
    notifications,
    ledgers,
    enrollments,
    users,
    existingRecords,
    existingRecordVersions,
  };
  return {
    sources,
    summary: {
      classes: classes.length,
      students: students.length,
      evaluations: evaluations.length,
      notifications: notifications.length,
      ledgers: ledgers.length,
      enrollments: enrollments.length,
      users: users.length,
      existingRecords: existingRecords.length,
    },
  };
}
