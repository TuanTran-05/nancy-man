import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import formidable, { type File as FormidableFile } from 'formidable';
import { verifyAuthContext, getDb } from '../../lib/auth/verifyAuth.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import {
  FILE_TYPE_ERROR,
  getPrintRequestDateKey,
  normalizePrintRequestDateKey,
  normalizePrintQuantity,
  validatePrintRequestFile,
} from '../../../../shared/printRequests.js';
import { sanitizeFilename, formatClientError } from './utils.js';
import { authUserFromContext, staffActorFromContext } from '../../lib/auth/contextUser.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';

function getFieldValue(fields: formidable.Fields, key: string): string {
  return (fields[key]?.[0] || '').trim();
}

function parseQuantities(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => Number(entry)) : [];
  } catch {
    return [];
  }
}

function getPrintRequestFiles(files: formidable.Files): FormidableFile[] {
  const uploaded = files.files || files.file || [];
  return Array.isArray(uploaded) ? uploaded : [uploaded];
}

export async function handleUploadPrintRequest(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const verified = await verifyAuthContext(req, res, ['teacher']);
  if (!verified) return;
  const user = authUserFromContext(verified.context);
  const actor = staffActorFromContext(verified.context);

  try {
    const form = formidable({
      maxFileSize: 20 * 1024 * 1024,
      maxFiles: 10,
    });
    const [fields, parsedFiles] = await form.parse(req);
    const classId = getFieldValue(fields, 'classId');
    const neededAt = getFieldValue(fields, 'neededAt');
    const explicitNeededDate = getFieldValue(fields, 'neededDate');
    const note = getFieldValue(fields, 'note');
    const files = getPrintRequestFiles(parsedFiles);
    const quantities = parseQuantities(getFieldValue(fields, 'quantities'));

    if (!classId || !neededAt || files.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const neededDate = normalizePrintRequestDateKey(explicitNeededDate, neededAt);
    if (!neededDate) {
      return res.status(400).json({ success: false, error: 'Invalid neededAt or neededDate' });
    }
    if (quantities.length !== files.length) {
      return res.status(400).json({ success: false, error: 'Each file requires a quantity' });
    }

    const db = getDb();

    const classSnap = await db.collection('classes').doc(classId).get();
    if (!classSnap.exists) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }
    const classData = classSnap.data() || {};
    if (String(classData.teacherId || '') !== user.uid) {
      return res.status(403).json({ success: false, error: 'Not authorized for this class' });
    }

    const preparedFiles: Array<{
      source: FormidableFile;
      id: string;
      originalFilename: string;
      fileType: string;
      mimeType: string;
      fileSize: number;
      quantity: number;
    }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const uploadedFile = files[index];
      const filename = uploadedFile.originalFilename || 'document';
      const validation = validatePrintRequestFile(filename, uploadedFile.mimetype || '');
      if ('error' in validation) {
        return res.status(400).json({ success: false, error: FILE_TYPE_ERROR });
      }
      const quantity = normalizePrintQuantity(quantities[index]);
      if (!quantity) {
        return res
          .status(400)
          .json({ success: false, error: 'Each file quantity must be a positive whole number' });
      }
      preparedFiles.push({
        source: uploadedFile,
        id: randomUUID(),
        originalFilename: filename,
        fileType: validation.fileType,
        mimeType: validation.mimeType,
        fileSize: uploadedFile.size,
        quantity,
      });
    }

    const store = getObjectStore();
    const requestRef = db.collection('print_requests').doc();
    const uploadedFiles: Array<{
      id: string;
      originalFilename: string;
      fileType: string;
      mimeType: string;
      fileSize: number;
      storagePath: string;
      quantity: number;
    }> = [];
    const uploadedStoragePaths: string[] = [];

    const now = new Date().toISOString();
    const docData = {
      teacherId: user.uid,
      teacherName: actor.displayName || user.email || 'Unknown',
      classId,
      className: String(classData.name || ''),
      neededAt,
      neededDate,
      createdDate: getPrintRequestDateKey(now),
      status: 'pending',
      note,
      files: uploadedFiles,
      createdAt: now,
      updatedAt: now,
    };

    try {
      for (const prepared of preparedFiles) {
        const storagePath = `print_requests/${user.uid}/${requestRef.id}/${randomUUID()}_${sanitizeFilename(
          prepared.originalFilename,
          prepared.fileType
        )}`;
        await store.save(storagePath, readFileSync(prepared.source.filepath), {
          contentType: prepared.mimeType,
        });
        uploadedStoragePaths.push(storagePath);
        uploadedFiles.push({
          id: prepared.id,
          originalFilename: prepared.originalFilename,
          fileType: prepared.fileType,
          mimeType: prepared.mimeType,
          fileSize: prepared.fileSize,
          storagePath,
          quantity: prepared.quantity,
        });
      }
      docData.files = uploadedFiles;
      await requestRef.set(docData);
    } catch (documentStoreErr) {
      for (const storagePath of uploadedStoragePaths) {
        try {
          await store.delete(storagePath, { ignoreNotFound: true });
        } catch (deleteErr) {
          console.error('[PrintRequests] Failed to delete orphaned storage file:', deleteErr);
        }
      }
      throw documentStoreErr;
    }

    void writeAuditLog(db, {
      userId: user.uid,
      userRole: 'teacher',
      action: 'create',
      collection: 'print_requests',
      documentId: requestRef.id,
      metadata: { classId, className: docData.className, fileCount: uploadedFiles.length },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    await touchRealtimeEvent('print-requests');
    return res.status(201).json({ success: true, id: requestRef.id, ...docData });
  } catch (err) {
    console.error('[PrintRequests] Upload error:', err);
    const clientError = formatClientError(err, 'Failed to upload print request', 'File too large');
    return res.status(clientError.statusCode).json({ success: false, error: clientError.error });
  }
}

export async function handlePrintRequestFile(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const verified = await verifyAuthContext(req, res, ['teacher', 'office']);
  if (!verified) return;
  const user = authUserFromContext(verified.context);
  const actor = staffActorFromContext(verified.context);

  const requestId = typeof req.query.requestId === 'string' ? req.query.requestId : '';
  const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : '';
  if (!requestId || !fileId) {
    return res.status(400).json({ success: false, error: 'Missing requestId or fileId' });
  }

  try {
    const db = getDb();
    const role = actor.role;
    const requestSnap = await db.collection('print_requests').doc(requestId).get();
    if (!requestSnap.exists) {
      return res.status(404).json({ success: false, error: 'Print request not found' });
    }
    const request = requestSnap.data() || {};
    if (role !== 'office' && String(request.teacherId || '') !== user.uid) {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }
    const files = Array.isArray(request.files) ? request.files : [];
    const targetFile = files.find((file) => file && file.id === fileId);
    if (!targetFile?.storagePath) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const safeFilename = sanitizeFilename(
      targetFile.originalFilename || `document.${targetFile.fileType || 'pdf'}`,
      targetFile.fileType || 'pdf'
    );
    const url = await getObjectStore().createSignedReadUrl(targetFile.storagePath, {
      expiresMs: 10 * 60 * 1000,
      responseDisposition: `attachment; filename="${safeFilename}"`,
      ...(targetFile.mimeType ? { contentType: targetFile.mimeType } : {}),
    });
    return res.status(200).json({ success: true, url });
  } catch (err) {
    console.error('[PrintRequests] File URL error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate download URL' });
  }
}
