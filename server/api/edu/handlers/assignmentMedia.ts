import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import formidable from 'formidable';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { assertTeacherClassAccess } from '../../lib/services/classService.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';

const MAX_MEDIA_FILE_SIZE = 200 * 1024 * 1024;

const MEDIA_MIME_TYPES = {
  audio: {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    webm: 'audio/webm',
  },
  video: {
    mp4: 'video/mp4',
    webm: 'video/webm',
  },
  image: {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  },
  document: {
    pdf: 'application/pdf',
  },
} as const;

type AssignmentMediaType = keyof typeof MEDIA_MIME_TYPES;

function firstField(fields: formidable.Fields<string>, key: string): string {
  return (fields[key]?.[0] || '').trim();
}

function extensionFor(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

function sanitizeFilename(filename: string, fallbackExt: string): string {
  const base = filename
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || `media.${fallbackExt}`;
}

function isMediaType(value: string): value is AssignmentMediaType {
  return value === 'audio' || value === 'video' || value === 'image' || value === 'document';
}

export async function handleAssignmentMediaUpload(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  uid: string,
  role: string
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const form = formidable({ maxFileSize: MAX_MEDIA_FILE_SIZE, maxFiles: 1 });
    const [fields, files] = await form.parse(req);
    const classId = firstField(fields, 'classId');
    const mediaTypeValue = firstField(fields, 'mediaType');
    const title = firstField(fields, 'title');
    const altText = firstField(fields, 'altText');
    const transcript = firstField(fields, 'transcript');
    const uploadedFile = files.file?.[0];

    if (!classId || !isMediaType(mediaTypeValue) || !uploadedFile) {
      return res.status(400).json({ success: false, error: 'Missing required media fields' });
    }

    await assertTeacherClassAccess(db, classId, uid, role);

    const originalFilename = uploadedFile.originalFilename || `media.${mediaTypeValue}`;
    const ext = extensionFor(originalFilename);
    const expectedMime =
      MEDIA_MIME_TYPES[mediaTypeValue][
        ext as keyof (typeof MEDIA_MIME_TYPES)[typeof mediaTypeValue]
      ];
    if (!expectedMime || uploadedFile.mimetype !== expectedMime) {
      return res.status(400).json({
        success: false,
        error: `Invalid ${mediaTypeValue} file type`,
      });
    }

    const safeName = sanitizeFilename(originalFilename, ext);
    const storagePath = `assignment_media/${classId}/${uid}/${Date.now()}_${randomUUID()}_${safeName}`;

    const store = getObjectStore();
    await store.save(storagePath, readFileSync(uploadedFile.filepath), {
      contentType: expectedMime,
    });

    const media = {
      id: randomUUID(),
      type: mediaTypeValue,
      source: 'upload' as const,
      url: await store.createPersistentReadUrl(storagePath, { contentType: expectedMime }),
      storagePath,
      ...(title ? { title } : {}),
      ...(altText ? { altText } : {}),
      ...(transcript ? { transcript } : {}),
      displayMode: 'inline' as const,
    };

    writeAuditLog(db, {
      userId: uid,
      userRole: role,
      action: 'create',
      collection: 'assignment_media',
      documentId: media.id,
      metadata: { classId, type: mediaTypeValue, storagePath },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    }).catch((err) => console.error('[AuditLog] Failed to write assignment media upload:', err));

    return res.status(201).json({ success: true, media });
  } catch (err) {
    console.error('[AssignmentMedia] Upload failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to upload assignment media';
    const statusCode =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? Number((err as { statusCode?: unknown }).statusCode) || 500
        : 500;
    return res.status(statusCode).json({ success: false, error: message });
  }
}
