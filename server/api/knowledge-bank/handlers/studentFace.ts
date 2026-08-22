import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { randomUUID } from 'crypto';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { verifyAuthContext, getDb } from '../../lib/auth/verifyAuth.js';
import { assertCanReadStudentScopedResource } from '../../lib/auth/authz.js';
import {
  MAX_IMAGE_SIZE,
  parseSingleFileForm,
  getExt,
  sanitizeFilename,
  saveImageFile,
  formatClientError,
  createSignedReadUrl,
} from './utils.js';
import { authUserFromContext, staffActorFromContext } from '../../lib/auth/contextUser.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';

async function assertStudentFaceUploadAccess(
  db: DocumentStore,
  user: { uid: string },
  role: string,
  classId: string,
  studentDocId?: string
) {
  if (role !== 'admin' && role !== 'teacher') {
    return { ok: false as const, status: 403, error: 'Permission denied' };
  }

  if (!classId && !studentDocId) {
    return { ok: false as const, status: 400, error: 'Missing classId or studentDocId' };
  }

  if (studentDocId && studentDocId !== 'new' && studentDocId !== 'pending') {
    const studentDoc = await db.collection('students').doc(studentDocId).get();
    if (!studentDoc.exists) {
      return { ok: false as const, status: 404, error: 'Student not found' };
    }
    const student = studentDoc.data() || {};
    if (role !== 'admin' && student.teacherId !== user.uid) {
      return { ok: false as const, status: 403, error: 'Not authorized for this student' };
    }
    return { ok: true as const, role };
  }

  const classDoc = await db.collection('classes').doc(classId).get();
  if (!classDoc.exists) {
    return { ok: false as const, status: 404, error: 'Class not found' };
  }
  const classData = classDoc.data() || {};
  if (role !== 'admin' && classData.teacherId !== user.uid) {
    return { ok: false as const, status: 403, error: 'Not authorized for this class' };
  }
  return { ok: true as const, role };
}

async function authorizeStudentFaceRead(req: ApiRequest, res: ApiResponse) {
  const verified = await verifyAuthContext(req, res);
  if (!verified) return null;

  const studentId = typeof req.query.studentId === 'string' ? req.query.studentId.trim() : '';
  const storagePath = typeof req.query.storagePath === 'string' ? req.query.storagePath.trim() : '';
  if (!studentId || !storagePath) {
    res.status(400).json({ success: false, error: 'Missing studentId or storagePath' });
    return null;
  }
  if (!storagePath.startsWith('student_faces/')) {
    res.status(400).json({ success: false, error: 'Invalid student face path' });
    return null;
  }

  try {
    const db = getDb();
    const student = await assertCanReadStudentScopedResource(db, verified.context, studentId);
    const storedPath = String(student.faceImageStoragePath || student.faceImage || '');
    if (storedPath !== storagePath) {
      res.status(403).json({ success: false, error: 'Not authorized for this face image' });
      return null;
    }

    return { storagePath };
  } catch (err: any) {
    const clientError = formatClientError(err, 'Failed to authorize face image');
    res.status(clientError.statusCode).json({
      success: false,
      error: clientError.error,
    });
    return null;
  }
}

export async function handleUploadStudentFace(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin', 'teacher']);
  if (!verified) return;
  const user = authUserFromContext(verified.context);
  const actor = staffActorFromContext(verified.context);

  try {
    const { fields, uploadedFile } = await parseSingleFileForm(req, MAX_IMAGE_SIZE);
    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: 'Missing image file' });
    }

    const classId = fields.classId?.[0] || '';
    const studentDocId = fields.studentDocId?.[0] || '';
    const access = await assertStudentFaceUploadAccess(
      getDb(),
      user,
      actor.role,
      classId,
      studentDocId
    );
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const filename = uploadedFile.originalFilename || 'face.jpg';
    const ext = getExt(filename) || 'jpg';
    const safeStudentId = sanitizeFilename(studentDocId || 'pending', 'jpg');
    const storagePath = `student_faces/${user.uid}/${safeStudentId}/${Date.now()}_${randomUUID()}_${sanitizeFilename(
      filename,
      ext
    )}`;
    const result = await saveImageFile(uploadedFile, storagePath, ext, {
      createDownloadToken: false,
    });
    return res.status(201).json({
      success: true,
      ...result,
      faceImageStoragePath: result.storagePath,
    });
  } catch (err: any) {
    console.error('[KnowledgeBank] Student face upload error:', err);
    const clientError = formatClientError(err, 'Failed to upload image', 'Image too large');
    return res.status(clientError.statusCode).json({
      success: false,
      error: clientError.error,
    });
  }
}

export async function handleStudentFaceUrl(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authorized = await authorizeStudentFaceRead(req, res);
  if (!authorized) return;

  try {
    const url = await createSignedReadUrl(authorized.storagePath);
    return res.status(200).json({ success: true, url, expiresIn: 600 });
  } catch (err: any) {
    const clientError = formatClientError(err, 'Failed to generate face image URL');
    return res.status(clientError.statusCode).json({
      success: false,
      error: clientError.error,
    });
  }
}

export async function handleStudentFaceImage(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authorized = await authorizeStudentFaceRead(req, res);
  if (!authorized) return;

  try {
    const store = getObjectStore();
    const [imageBuffer, metadata] = await Promise.all([
      store.download(authorized.storagePath),
      store.stat(authorized.storagePath).catch(() => ({
        size: 0,
        contentType: 'application/octet-stream',
      })),
    ]);
    const contentType =
      typeof metadata.contentType === 'string' && metadata.contentType
        ? metadata.contentType
        : 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(imageBuffer);
  } catch (err: any) {
    const clientError = formatClientError(err, 'Failed to load face image');
    return res.status(clientError.statusCode).json({
      success: false,
      error: clientError.error,
    });
  }
}
