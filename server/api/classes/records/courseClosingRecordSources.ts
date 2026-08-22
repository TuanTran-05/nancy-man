import type { DocumentStore } from '@/server/db/documentStore.js';
import { isCurrentAcademicCourseRecord, selectMidtermEvaluation } from '../../../../shared/academic.js';
import { closingMonthFromCourseEnd } from '../../../../shared/courseClosingRecords.js';
import { parseDateOnly, toDateOnlyString } from '../../zalo/helpers/tuitionDates.js';

export interface ArchiveMidtermSource {
  evaluationId: string;
  evaluationVersion: string;
  data: Record<string, unknown>;
}

export interface CourseClosingArchiveIdentity {
  courseId: string;
  classId: string;
  className: string;
  courseStartDate: string;
  courseEndDate: string;
  closingMonth: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  teacherId: string;
  teacherName: string;
}

export type CourseClosingRecordSourceErrorCode =
  | 'COURSE_CLOSING_RECORD_INVALID_COURSE_END_DATE'
  | 'COURSE_CLOSING_RECORD_INVALID_SOURCE_DATE'
  | 'COURSE_CLOSING_RECORD_MISSING_IDENTITY';

export class CourseClosingRecordSourceError extends Error {
  constructor(
    public readonly errorCode: CourseClosingRecordSourceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CourseClosingRecordSourceError';
  }
}

export function normalizeArchiveDateOnly(value: unknown, fieldName: string): string {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    const errorCode: CourseClosingRecordSourceErrorCode =
      fieldName === 'courseEndDate'
        ? 'COURSE_CLOSING_RECORD_INVALID_COURSE_END_DATE'
        : 'COURSE_CLOSING_RECORD_INVALID_SOURCE_DATE';
    throw new CourseClosingRecordSourceError(
      errorCode,
      `Invalid date for ${fieldName}: ${String(value)}`
    );
  }
  return toDateOnlyString(parsed);
}

export async function resolveCourseClosingArchiveIdentity(
  db: DocumentStore,
  context: {
    courseId: string;
    classData: Record<string, unknown>;
    studentData: Record<string, unknown>;
  },
  actor: { uid: string; role?: string; name?: string }
): Promise<CourseClosingArchiveIdentity> {
  const classData = context.classData || {};
  const studentData = context.studentData || {};

  const courseId = String(context.courseId || '');
  const classId = String(classData.id || classData.classId || '');
  const className = String(classData.name || classData.className || '');
  const studentId = String(studentData.id || studentData.studentId || '');
  const studentName = String(studentData.name || studentData.studentName || '');
  const studentCode = String(
    studentData.code || studentData.studentId || studentData.id || ''
  );

  if (!courseId || !classId || !studentId) {
    throw new CourseClosingRecordSourceError(
      'COURSE_CLOSING_RECORD_MISSING_IDENTITY',
      'Missing courseId, classId, or studentId in context'
    );
  }

  const rawStartDate = classData.startDate || classData.courseStartDate;
  const rawEndDate = classData.endDate || classData.courseEndDate;

  const courseStartDate = normalizeArchiveDateOnly(rawStartDate, 'courseStartDate');
  const courseEndDate = normalizeArchiveDateOnly(rawEndDate, 'courseEndDate');
  const closingMonth = closingMonthFromCourseEnd(courseEndDate);

  const teacherId = String(
    classData.teacherId || studentData.teacherId || actor.uid || ''
  );

  let teacherName = String(classData.teacherName || '');
  if (teacherId) {
    try {
      const teacherDoc = await db.collection('users').doc(teacherId).get();
      if (teacherDoc.exists) {
        const tData = teacherDoc.data() || {};
        teacherName = String(tData.displayName || tData.name || teacherName || teacherId);
      }
    } catch {
      // Fallback if user lookup fails
    }
  }

  if (!teacherName) {
    teacherName = actor.uid === teacherId && actor.name ? actor.name : teacherId;
  }

  return {
    courseId,
    classId,
    className,
    courseStartDate,
    courseEndDate,
    closingMonth,
    studentId,
    studentName,
    studentCode,
    teacherId,
    teacherName,
  };
}

export async function loadCurrentMidtermEvaluation(
  db: DocumentStore,
  context: {
    classData: Record<string, unknown>;
    studentData: Record<string, unknown>;
  }
): Promise<ArchiveMidtermSource | undefined> {
  const classId = String(context.classData?.id || '');
  const studentId = String(context.studentData?.id || context.studentData?.studentId || '');

  if (!classId || !studentId) return undefined;

  const snapshot = await db
    .collection('evaluations')
    .where('classId', '==', classId)
    .where('studentId', '==', studentId)
    .get();

  const candidates: Array<{ id: string; version: string; data: Record<string, unknown> }> = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    if (
      String(data.evaluationType || '') === 'midterm' &&
      isCurrentAcademicCourseRecord(data, context.classData)
    ) {
      const version = String(
        data.updatedAt?.toDate?.()?.toISOString() ||
          data.updatedAt ||
          data.createdAt?.toDate?.()?.toISOString() ||
          data.createdAt ||
          data.date ||
          doc.id
      );
      candidates.push({ id: doc.id, version, data });
    }
  }

  if (candidates.length === 0) return undefined;

  const selected = selectMidtermEvaluation(candidates.map((c) => c.data));
  if (!selected) return undefined;

  const match = candidates.find((c) => c.data === selected);
  if (!match) return undefined;

  return {
    evaluationId: match.id,
    evaluationVersion: match.version,
    data: match.data,
  };
}
