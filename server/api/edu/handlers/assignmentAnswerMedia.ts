import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import formidable from 'formidable';
import { getUserContext, assertActiveUser, assertStudentInClass } from '../../lib/auth/authz.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { getAssessmentQuestionList } from '../../../../shared/assignmentAssessment.js';
import { canStudentAccessAssignment } from '../../../../shared/assignmentDelivery.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';

const MAX_ANSWER_MEDIA_FILE_SIZE = 50 * 1024 * 1024;
const ANSWER_MEDIA_MIME_TYPES = {
  audio: {
    webm: 'audio/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
  },
  document: {
    pdf: 'application/pdf',
  },
} as const;

function firstField(fields: formidable.Fields<string>, key: string): string {
  return (fields[key]?.[0] || '').trim();
}

function extensionFor(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

export async function handleAssignmentAnswerMediaUpload(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: { uid: string; email?: string }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ctx = await getUserContext(db, user);
  assertActiveUser(ctx);
  if (ctx.role !== 'student' || !ctx.studentId) {
    return res.status(403).json({ success: false, error: 'Student context required' });
  }

  const form = formidable({ maxFileSize: MAX_ANSWER_MEDIA_FILE_SIZE, maxFiles: 1 });
  const [fields, files] = await form.parse(req);
  const assignmentId = firstField(fields, 'assignmentId');
  const questionId = firstField(fields, 'questionId');
  const mediaType = firstField(fields, 'mediaType') as keyof typeof ANSWER_MEDIA_MIME_TYPES;
  const uploadedFile = files.file?.[0];

  if (!assignmentId || !questionId || !uploadedFile || !ANSWER_MEDIA_MIME_TYPES[mediaType]) {
    return res.status(400).json({ success: false, error: 'Missing required answer media fields' });
  }

  const assignmentSnap = await db.collection('assignments').doc(assignmentId).get();
  if (!assignmentSnap.exists) {
    return res.status(404).json({ success: false, error: 'Assignment not found' });
  }

  const assignmentData = assignmentSnap.data()!;
  if (assignmentData.assessment?.version !== 2) {
    return res.status(403).json({ success: false, error: 'Assignment is not available' });
  }
  if (
    !canStudentAccessAssignment(
      { classId: assignmentData.classId, deliveryPolicy: assignmentData.deliveryPolicy },
      { classId: ctx.classId, studentId: ctx.studentId }
    )
  ) {
    return res
      .status(403)
      .json({ success: false, error: 'Assignment is not available for this student' });
  }
  await assertStudentInClass(db, ctx.studentId, String(assignmentData.classId || ''));

  const dueMs = Date.parse(String(assignmentData.dueDate || ''));
  if (Number.isFinite(dueMs) && Date.now() > dueMs + 24 * 60 * 60 * 1000 - 1) {
    return res.status(400).json({ success: false, error: 'Assignment is past due' });
  }

  const question = getAssessmentQuestionList(assignmentData.assessment).find(
    (item) => item.id === questionId
  );
  if (
    !question ||
    (question.responseMode !== 'speaking_recording' && question.responseMode !== 'file_upload')
  ) {
    return res
      .status(400)
      .json({ success: false, error: 'Question does not accept uploaded answers' });
  }
  if (question.responseMode === 'speaking_recording' && mediaType !== 'audio') {
    return res.status(400).json({ success: false, error: 'Speaking answers must be audio' });
  }
  if (question.responseMode === 'file_upload' && mediaType !== 'document') {
    return res.status(400).json({ success: false, error: 'File-upload answers must be documents' });
  }

  const ext = extensionFor(uploadedFile.originalFilename || `answer.${mediaType}`);
  const expectedMime =
    ANSWER_MEDIA_MIME_TYPES[mediaType][
      ext as keyof (typeof ANSWER_MEDIA_MIME_TYPES)[typeof mediaType]
    ];
  if (!expectedMime || uploadedFile.mimetype !== expectedMime) {
    return res.status(400).json({ success: false, error: `Invalid ${mediaType} answer file type` });
  }

  const storagePath = `assignment_answers/${assignmentId}/${ctx.studentId}/${questionId}/${Date.now()}_${randomUUID()}.${ext}`;

  const store = getObjectStore();
  await store.save(storagePath, readFileSync(uploadedFile.filepath), {
    contentType: expectedMime,
  });

  const media = {
    id: randomUUID(),
    type: mediaType,
    source: 'upload' as const,
    url: await store.createPersistentReadUrl(storagePath, { contentType: expectedMime }),
    storagePath,
    title: uploadedFile.originalFilename || 'answer',
    displayMode: 'inline' as const,
  };

  writeAuditLog(db, {
    userId: user.uid,
    userRole: ctx.role,
    action: 'create',
    collection: 'assignment_answer_media',
    documentId: media.id,
    metadata: { assignmentId, questionId, storagePath },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  }).catch((err) =>
    console.error('[AuditLog] Failed to write assignment answer media upload:', err)
  );

  return res.status(201).json({ success: true, media });
}
