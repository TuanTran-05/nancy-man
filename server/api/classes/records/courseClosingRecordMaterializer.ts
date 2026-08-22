import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import {
  COURSE_CLOSING_DOCX_MIME,
  courseClosingDownloadFilename,
  courseClosingStoragePath,
  type ClosingDocumentType,
  type CourseClosingRecord,
} from '../../../../shared/courseClosingRecords.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';
import { renderCourseClosingDocument } from './courseClosingRecordDocuments.js';

export const COURSE_CLOSING_DOCUMENT_GENERATOR_VERSION = '2' as const;

export interface MaterializePayload {
  recordId: string;
  documentType: ClosingDocumentType;
  templateVersion: 1;
  force?: boolean;
}

export interface MaterializeDeps {
  save?: (
    path: string,
    buffer: Buffer,
    options: {
      contentType: string;
      metadata: { courseClosingGeneratorVersion: string };
    }
  ) => Promise<void>;
  render?: (record: CourseClosingRecord, documentType: ClosingDocumentType) => Promise<Buffer>;
}

export async function materializeCourseClosingDocument(
  db: DocumentStore,
  payload: MaterializePayload,
  deps: MaterializeDeps = {}
): Promise<void> {
  const ref = db.collection('course_closing_records').doc(payload.recordId);
  const now = new Date().toISOString();

  // 1. Transactionally increment attempt counter and update status to pending/retrying
  const currentRecord = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) {
      throw new Error(`Course closing record ${payload.recordId} not found`);
    }
    const record = doc.data() as CourseClosingRecord;
    const docField =
      payload.documentType === 'evaluation' ? 'evaluationDocument' : 'tuitionDocument';

    const currentDoc = record[docField];
    if (!payload.force && currentDoc.status === 'ready' && currentDoc.storagePath) {
      return null; // Already ready
    }

    const nextAttempts = (currentDoc.attempts || 0) + 1;
    const nextStatus = nextAttempts > 1 ? 'retrying' : 'pending';

    tx.update(ref, {
      [`${docField}.attempts`]: nextAttempts,
      [`${docField}.status`]: nextStatus,
      [`${docField}.lastAttemptAt`]: now,
      updatedAt: now,
    });

    return { ...record, [docField]: { ...currentDoc, attempts: nextAttempts, status: nextStatus } };
  });

  if (!currentRecord) {
    return; // Already ready
  }

  const docField = payload.documentType === 'evaluation' ? 'evaluationDocument' : 'tuitionDocument';
  const artifactPathInput = {
    closingMonth: currentRecord.closingMonth,
    classId: currentRecord.classId,
    courseId: currentRecord.courseId,
    studentId: currentRecord.studentId,
    documentType: payload.documentType,
    templateVersion: payload.templateVersion,
  };
  const storagePath = courseClosingStoragePath(artifactPathInput);

  const downloadFilename = courseClosingDownloadFilename(
    currentRecord.studentName,
    payload.documentType
  );

  try {
    const renderFn = deps.render || renderCourseClosingDocument;
    const buffer = await renderFn(currentRecord, payload.documentType);
    const metadata = {
      courseClosingGeneratorVersion: COURSE_CLOSING_DOCUMENT_GENERATOR_VERSION,
    };

    if (deps.save) {
      await deps.save(storagePath, buffer, {
        contentType: COURSE_CLOSING_DOCX_MIME,
        metadata,
      });
    } else {
      await getObjectStore().save(storagePath, buffer, {
        contentType: COURSE_CLOSING_DOCX_MIME,
        metadata,
      });
    }

    await ref.update({
      [`${docField}.status`]: 'ready',
      [`${docField}.storagePath`]: storagePath,
      [`${docField}.downloadFilename`]: downloadFilename,
      [`${docField}.generatedAt`]: now,
      [`${docField}.lastErrorCode`]: FieldValue.delete(),
      updatedAt: now,
    });
  } catch (err: any) {
    const attempts = currentRecord[docField].attempts || 1;
    const isFailed = attempts >= 5;
    const nextStatus = isFailed ? 'failed' : 'retrying';
    const errorCode = err?.errorCode || err?.code || 'MATERIALIZATION_FAILED';

    await ref.update({
      [`${docField}.status`]: nextStatus,
      [`${docField}.lastErrorCode`]: String(errorCode),
      updatedAt: now,
    });

    throw err;
  }
}
