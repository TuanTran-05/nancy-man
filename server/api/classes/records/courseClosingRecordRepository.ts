import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  COURSE_CLOSING_DOCX_MIME,
  COURSE_CLOSING_RECORD_VERSION,
  courseClosingDownloadFilename,
  courseClosingRecordId,
  normalizeSearchText,
  type CourseClosingEvaluationSnapshot,
  type CourseClosingRecord,
  type CourseClosingTuitionSnapshot,
} from '../../../../shared/courseClosingRecords.js';
import type { CourseClosingArchiveIdentity } from './courseClosingRecordSources.js';

export async function upsertEvaluationRecord(
  db: DocumentStore,
  input: {
    identity: CourseClosingArchiveIdentity;
    snapshot: CourseClosingEvaluationSnapshot;
    sourceNotificationId?: string;
  }
): Promise<CourseClosingRecord> {
  const recordId = courseClosingRecordId(input.identity.courseId, input.identity.studentId);
  const ref = db.collection('course_closing_records').doc(recordId);
  const now = new Date().toISOString();

  return await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (doc.exists) {
      const existing = doc.data() as CourseClosingRecord;
      if (
        existing.courseId !== input.identity.courseId ||
        existing.studentId !== input.identity.studentId ||
        existing.classId !== input.identity.classId
      ) {
        throw new Error('COURSE_CLOSING_RECORD_IDENTITY_MISMATCH');
      }

      if (existing.evaluationDocument?.status === 'ready' && existing.evaluationSnapshot) {
        return existing;
      }

      const updatedRecord: CourseClosingRecord = {
        ...existing,
        evaluationSnapshot: existing.evaluationSnapshot || input.snapshot,
        evaluationDataAvailability: { status: 'verified' },
        evaluationDocument: {
          ...existing.evaluationDocument,
          type: 'evaluation',
          status: existing.evaluationDocument?.status === 'ready' ? 'ready' : 'pending',
          templateVersion: 1,
          mimeType: COURSE_CLOSING_DOCX_MIME,
          sourceNotificationId:
            existing.evaluationDocument?.sourceNotificationId || input.sourceNotificationId,
          attempts: existing.evaluationDocument?.attempts || 0,
        },
        updatedAt: now,
      };

      tx.set(ref, updatedRecord, { merge: true });
      return updatedRecord;
    }

    const newRecord: CourseClosingRecord = {
      id: recordId,
      recordVersion: COURSE_CLOSING_RECORD_VERSION,
      closingMonth: input.identity.closingMonth,
      courseId: input.identity.courseId,
      classId: input.identity.classId,
      className: input.identity.className,
      classNameNormalized: normalizeSearchText(input.identity.className),
      courseStartDate: input.identity.courseStartDate,
      courseEndDate: input.identity.courseEndDate,
      studentId: input.identity.studentId,
      studentName: input.identity.studentName,
      studentNameNormalized: normalizeSearchText(input.identity.studentName),
      studentCode: input.identity.studentCode,
      teacherId: input.identity.teacherId,
      teacherName: input.identity.teacherName,
      evaluationSnapshot: input.snapshot,
      evaluationDataAvailability: { status: 'verified' },
      evaluationDocument: {
        type: 'evaluation',
        status: 'pending',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        sourceNotificationId: input.sourceNotificationId,
        attempts: 0,
      },
      tuitionDocument: {
        type: 'tuition',
        status: 'not_requested',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        attempts: 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    tx.set(ref, newRecord);
    return newRecord;
  });
}

export async function upsertTuitionRecord(
  db: DocumentStore,
  input: {
    identity: CourseClosingArchiveIdentity;
    snapshot: CourseClosingTuitionSnapshot;
    sourceNotificationId?: string;
  }
): Promise<CourseClosingRecord> {
  const recordId = courseClosingRecordId(input.identity.courseId, input.identity.studentId);
  const ref = db.collection('course_closing_records').doc(recordId);
  const now = new Date().toISOString();

  return await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (doc.exists) {
      const existing = doc.data() as CourseClosingRecord;
      if (
        existing.courseId !== input.identity.courseId ||
        existing.studentId !== input.identity.studentId ||
        existing.classId !== input.identity.classId
      ) {
        throw new Error('COURSE_CLOSING_RECORD_IDENTITY_MISMATCH');
      }

      if (existing.tuitionDocument?.status === 'ready' && existing.tuitionSnapshot) {
        return existing;
      }

      const updatedRecord: CourseClosingRecord = {
        ...existing,
        tuitionSnapshot: existing.tuitionSnapshot || input.snapshot,
        tuitionDataAvailability: { status: 'verified' },
        tuitionDocument: {
          ...existing.tuitionDocument,
          type: 'tuition',
          status: existing.tuitionDocument?.status === 'ready' ? 'ready' : 'pending',
          templateVersion: 1,
          mimeType: COURSE_CLOSING_DOCX_MIME,
          sourceNotificationId:
            existing.tuitionDocument?.sourceNotificationId || input.sourceNotificationId,
          attempts: existing.tuitionDocument?.attempts || 0,
        },
        updatedAt: now,
      };

      tx.set(ref, updatedRecord, { merge: true });
      return updatedRecord;
    }

    const newRecord: CourseClosingRecord = {
      id: recordId,
      recordVersion: COURSE_CLOSING_RECORD_VERSION,
      closingMonth: input.identity.closingMonth,
      courseId: input.identity.courseId,
      classId: input.identity.classId,
      className: input.identity.className,
      classNameNormalized: normalizeSearchText(input.identity.className),
      courseStartDate: input.identity.courseStartDate,
      courseEndDate: input.identity.courseEndDate,
      studentId: input.identity.studentId,
      studentName: input.identity.studentName,
      studentNameNormalized: normalizeSearchText(input.identity.studentName),
      studentCode: input.identity.studentCode,
      teacherId: input.identity.teacherId,
      teacherName: input.identity.teacherName,
      tuitionSnapshot: input.snapshot,
      tuitionDataAvailability: { status: 'verified' },
      evaluationDocument: {
        type: 'evaluation',
        status: 'not_requested',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        attempts: 0,
      },
      tuitionDocument: {
        type: 'tuition',
        status: 'pending',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        sourceNotificationId: input.sourceNotificationId,
        attempts: 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    tx.set(ref, newRecord);
    return newRecord;
  });
}
