import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import formidable from 'formidable';
import { verifyAuthContext, getDb } from '../../lib/auth/verifyAuth.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { assertClassAccess } from '../../lib/auth/authz.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { authUserFromContext, staffActorFromContext } from '../../lib/auth/contextUser.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';
import {
  MAX_FILE_SIZE,
  MAX_PROGRAM_NAME_LENGTH,
  GLOBAL_SUCCESS_GRADES,
  ALLOWED_TYPES,
  verifyFileSignature,
  sanitizeFilename,
  getExt,
  formatClientError,
} from './utils.js';

export async function handleUpload(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin', 'teacher']);
  if (!verified) return;
  const user = authUserFromContext(verified.context);
  const actor = staffActorFromContext(verified.context);

  try {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      maxFiles: 1,
    });

    const [fields, files] = await form.parse(req);

    const title = (fields.title?.[0] || '').trim();
    const description = (fields.description?.[0] || '').trim();
    const uploadedFile = files.file?.[0];

    if (!title || !uploadedFile) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const fileBuffer = readFileSync(uploadedFile.filepath);
    const filename = uploadedFile.originalFilename || 'document';

    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const expectedMime = ALLOWED_TYPES[ext];

    if (!expectedMime) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only pdf and docx are allowed.',
      });
    }

    // Verify file content matches the claimed extension
    if (!verifyFileSignature(fileBuffer, ext)) {
      return res.status(400).json({
        success: false,
        error:
          'File content does not match the expected type. The file may be corrupted or renamed.',
      });
    }

    let target: Record<string, any> = {};
    const targetType = fields.targetType?.[0];
    const grade = fields.grade?.[0];
    const programName = fields.programName?.[0];
    const classId = fields.classId?.[0];
    const className = fields.className?.[0];
    const curriculumFamily = fields.curriculumFamily?.[0]?.trim();
    const unitNumberValue = fields.unitNumber?.[0];
    const resourceKind = fields.resourceKind?.[0]?.trim() || 'document';

    const db = getDb();

    if (targetType === 'grade' && grade) {
      const gradeNum = Number(grade);
      if (!Number.isInteger(gradeNum) || gradeNum < 1 || gradeNum > 12) {
        return res.status(400).json({ success: false, error: 'Invalid grade' });
      }
      target = { targetType: 'grade', grade: gradeNum };
    } else if (targetType === 'program' && programName?.trim()) {
      const trimmed = programName.trim();
      if (trimmed.length > MAX_PROGRAM_NAME_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `Program name must be ${MAX_PROGRAM_NAME_LENGTH} characters or fewer.`,
        });
      }
      target = { targetType: 'program', programName: trimmed };
    } else if (classId) {
      const classData = await assertClassAccess(db, verified.context, classId, 'write');
      target = { classId, className: className || String(classData.name || '') };
    } else {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid target (grade, program, or classId required).',
      });
    }

    let curriculumData: Record<string, any> = {};
    if (resourceKind !== 'document') {
      return res.status(400).json({ success: false, error: 'Invalid resource kind' });
    }

    if (curriculumFamily) {
      if (curriculumFamily !== 'global-success') {
        return res.status(400).json({ success: false, error: 'Invalid curriculum family' });
      }

      const gradeNum = Number(grade || target.grade);
      const unitNumber = Number(unitNumberValue);
      if (!Number.isInteger(gradeNum) || !GLOBAL_SUCCESS_GRADES.has(gradeNum)) {
        return res.status(400).json({ success: false, error: 'Invalid Global Success grade' });
      }
      if (!Number.isInteger(unitNumber) || unitNumber < 1 || unitNumber > 12) {
        return res.status(400).json({ success: false, error: 'Invalid unit number' });
      }

      target = {
        ...target,
        targetType: 'grade',
        grade: gradeNum,
        programName: programName?.trim() || `Grade ${gradeNum} Global Success`,
      };
      curriculumData = {
        curriculumFamily: 'global-success',
        unitNumber,
        resourceKind: 'document',
      };
    }

    const storagePath =
      curriculumData.curriculumFamily === 'global-success'
        ? `knowledge_bank/global-success/grade-${target.grade}/unit-${String(
            curriculumData.unitNumber
          ).padStart(2, '0')}/documents/${randomUUID()}_${sanitizeFilename(filename, ext)}`
        : `knowledge_bank/${randomUUID()}_${sanitizeFilename(filename, ext)}`;
    const store = getObjectStore();
    await store.save(storagePath, fileBuffer, { contentType: expectedMime });

    const uploadedByName = actor.displayName || user.email || 'Unknown';
    const now = new Date().toISOString();

    const docData = {
      title,
      description: description || null,
      ...target,
      ...curriculumData,
      uploadedBy: user.uid,
      uploadedByName,
      originalFilename: filename,
      fileType: ext,
      mimeType: expectedMime,
      fileSize: uploadedFile.size,
      storagePath,
      createdAt: now,
      downloadCount: 0,
    };

    let docRef: AppDocumentStore.DocumentReference;
    try {
      docRef = await db.collection('knowledge_bank').add(docData);
    } catch (documentStoreErr) {
      console.error(
        '[KnowledgeBank] DocumentStore write failed, cleaning up storage file:',
        documentStoreErr
      );
      try {
        await store.delete(storagePath, { ignoreNotFound: true });
      } catch (deleteErr) {
        console.error('[KnowledgeBank] Failed to delete orphaned storage file:', deleteErr);
      }
      throw documentStoreErr;
    }

    void writeAuditLog(db, {
      userId: user.uid,
      userRole: actor.role || 'teacher',
      action: 'create',
      collection: 'knowledge_bank',
      documentId: docRef.id,
      metadata: { title, fileType: ext, fileSize: uploadedFile.size },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    await touchRealtimeEvent('knowledge-bank');

    return res.status(201).json({ success: true, id: docRef.id, ...docData });
  } catch (err: any) {
    console.error('[KnowledgeBank] Upload error:', err);
    const clientError = formatClientError(err, 'Failed to upload document', 'File too large');
    return res.status(clientError.statusCode).json({
      success: false,
      error: clientError.error,
    });
  }
}
