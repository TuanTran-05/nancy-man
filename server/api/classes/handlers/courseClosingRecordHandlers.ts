import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  deriveCourseClosingRecordStatus,
  deriveTuitionArchiveStatus,
  normalizeSearchText,
  type ClosingDocumentType,
  type CourseClosingRecord,
} from '../../../../shared/courseClosingRecords.js';

import type { StaffActor } from '../../lib/auth/contextUser.js';
import { writeRequiredAuditLog } from '../../lib/logging/auditLog.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';

const ALLOWED_ROLES = new Set(['admin', 'office', 'accounting']);
const MAX_MONTH_RECORDS = 1000;

async function loadCourseClosingRecord(db: DocumentStore, recordId: string) {
  const ref = db.collection('course_closing_records').doc(recordId);
  const snapshot = await ref.get();
  return {
    ref,
    snapshot,
    record: snapshot.exists ? (snapshot.data() as CourseClosingRecord) : undefined,
  };
}

async function inspectCourseClosingCanonicalArtifact(
  db: DocumentStore,
  recordId: string,
  documentType: ClosingDocumentType
) {
  const loaded = await loadCourseClosingRecord(db, recordId);
  if (!loaded.record) {
    return { kind: 'not_found' as const };
  }

  const docField = documentType === 'evaluation' ? 'evaluationDocument' : 'tuitionDocument';
  const artifact = loaded.record[docField];
  if (!artifact || artifact.status !== 'ready' || !artifact.storagePath) {
    return {
      kind: 'storage_missing' as const,
    };
  }

  const exists = await getObjectStore().exists(artifact.storagePath);
  if (!exists) {
    return {
      kind: 'storage_missing' as const,
    };
  }

  return {
    kind: 'ready' as const,
    artifact,
  };
}

function sendCourseClosingCanonicalMissing(res: ApiResponse) {
  return res.status(409).json({
    success: false,
    errorCode: 'COURSE_CLOSING_RECORD_STORAGE_MISSING',
    error: 'The archived file is not available in Storage',
  });
}

export async function handleCourseClosingRecordMonth(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  _user: { uid: string },
  userInfo: StaffActor
) {
  if (!userInfo?.role || !ALLOWED_ROLES.has(userInfo.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const isAccounting = userInfo.role === 'accounting';

  try {
    let snapshot;
    if (isAccounting) {
      snapshot = await db
        .collection('course_closing_records')
        .where('tuitionDocument.status', 'in', ['pending', 'ready', 'retrying', 'failed'])
        .orderBy('closingMonth', 'desc')
        .limit(1)
        .get();
    } else {
      snapshot = await db
        .collection('course_closing_records')
        .orderBy('closingMonth', 'desc')
        .limit(1)
        .get();
    }

    if (!snapshot.empty) {
      const month = String(snapshot.docs[0].data()?.closingMonth || '');
      if (/^\d{4}-\d{2}$/.test(month)) {
        return res.status(200).json({ success: true, month });
      }
    }

    const currentVnMonth = new Date().toISOString().slice(0, 7);
    return res.status(200).json({ success: true, month: currentVnMonth });
  } catch (err: any) {
    const currentVnMonth = new Date().toISOString().slice(0, 7);
    return res.status(200).json({ success: true, month: currentVnMonth });
  }
}

export async function handleCourseClosingRecords(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  _user: { uid: string },
  userInfo: StaffActor
) {
  if (!userInfo?.role || !ALLOWED_ROLES.has(userInfo.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const month = String(req.query?.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res
      .status(400)
      .json({ success: false, error: 'month parameter is required and must be YYYY-MM' });
  }

  const rawQuery = String(req.query?.q || '').trim();
  const queryNormalized = normalizeSearchText(rawQuery);
  const isAccounting = userInfo.role === 'accounting';

  const snapshot = await db
    .collection('course_closing_records')
    .where('closingMonth', '==', month)
    .limit(MAX_MONTH_RECORDS + 1)
    .get();

  const rawDocs = snapshot.docs.map((doc) => doc.data() as CourseClosingRecord);
  const truncated = rawDocs.length > MAX_MONTH_RECORDS;
  const candidates = rawDocs.slice(0, MAX_MONTH_RECORDS);

  let filtered = candidates;
  if (queryNormalized) {
    filtered = candidates.filter((rec) => {
      const name = rec.studentNameNormalized || normalizeSearchText(rec.studentName);
      const cls = rec.classNameNormalized || normalizeSearchText(rec.className);
      const code = normalizeSearchText(rec.studentCode || '');
      return (
        name.includes(queryNormalized) ||
        cls.includes(queryNormalized) ||
        code.includes(queryNormalized)
      );
    });
  }

  filtered.sort((a, b) => {
    const classA = a.classNameNormalized || normalizeSearchText(a.className);
    const classB = b.classNameNormalized || normalizeSearchText(b.className);
    if (classA !== classB) return classA.localeCompare(classB);
    const nameA = a.studentNameNormalized || normalizeSearchText(a.studentName);
    const nameB = b.studentNameNormalized || normalizeSearchText(b.studentName);
    return nameA.localeCompare(nameB);
  });

  const records = filtered
    .map((record) => {
      if (isAccounting) {
        if (record.tuitionDocument?.status === 'not_requested') {
          return null;
        }

        const displayStatus = deriveTuitionArchiveStatus(record.tuitionDocument);
        return {
          id: record.id,
          recordVersion: record.recordVersion,
          closingMonth: record.closingMonth,
          courseId: record.courseId,
          classId: record.classId,
          className: record.className,
          classNameNormalized: record.classNameNormalized,
          courseStartDate: record.courseStartDate,
          courseEndDate: record.courseEndDate,
          studentId: record.studentId,
          studentName: record.studentName,
          studentNameNormalized: record.studentNameNormalized,
          studentCode: record.studentCode,
          teacherId: record.teacherId,
          teacherName: record.teacherName,
          tuitionSnapshot: record.tuitionSnapshot,
          tuitionDocument: record.tuitionDocument,
          displayStatus,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      }

      const displayStatus = deriveCourseClosingRecordStatus(record);
      return {
        ...record,
        displayStatus,
      };
    })
    .filter(Boolean);

  return res.status(200).json({
    success: true,
    month,
    records,
    truncated,
  });
}

export async function handleCourseClosingRecordFile(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string },
  userInfo: StaffActor
) {
  if (!userInfo?.role || !ALLOWED_ROLES.has(userInfo.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const recordId = String(req.query?.recordId || '').trim();
  const documentType = String(req.query?.documentType || '').trim() as ClosingDocumentType;
  const mode = String(req.query?.mode || 'inline').trim();

  if (
    !recordId ||
    (documentType !== 'evaluation' && documentType !== 'tuition') ||
    (mode !== 'inline' && mode !== 'attachment')
  ) {
    return res
      .status(400)
      .json({ success: false, error: 'Invalid recordId, documentType, or mode' });
  }

  if (userInfo.role === 'accounting' && documentType === 'evaluation') {
    return res
      .status(403)
      .json({ success: false, error: 'Accounting cannot access evaluation documents' });
  }

  const canonical = await inspectCourseClosingCanonicalArtifact(db, recordId, documentType);
  if (canonical.kind === 'not_found') {
    return res.status(404).json({ success: false, error: 'Course closing record not found' });
  }
  if (canonical.kind === 'storage_missing') {
    return sendCourseClosingCanonicalMissing(res);
  }

  const { artifact } = canonical;

  await writeRequiredAuditLog(db, {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'export',
    collection: 'course_closing_records',
    documentId: recordId,
    metadata: {
      documentType,
      mode,
      storagePath: artifact.storagePath,
    },
  });

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const filename = artifact.downloadFilename || `${documentType}.docx`;
  const url = await getObjectStore().createSignedReadUrl(artifact.storagePath, {
    expiresMs: 10 * 60 * 1000,
    responseDisposition: mode === 'attachment' ? `attachment; filename="${filename}"` : 'inline',
  });

  return res.status(200).json({
    success: true,
    url,
    downloadFilename: filename,
    expiresAt: expiresAt.toISOString(),
  });
}
