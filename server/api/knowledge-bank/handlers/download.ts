import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { FieldValue } from '@/server/db/documentStore.js';
import { verifyAuthContext, getDb } from '../../lib/auth/verifyAuth.js';
import { writeRequiredAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { ALLOWED_TYPES, sanitizeFilename } from './utils.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';

export async function handleDownload(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin', 'teacher']);
  if (!verified) return;
  const { context } = verified;

  const { id, mode } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing document id' });
  }

  try {
    const db = getDb();
    const doc = await db.collection('knowledge_bank').doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    const data = doc.data()!;
    const storagePath = data.storagePath;

    if (!storagePath) {
      return res.status(400).json({ success: false, error: 'Document has no associated file' });
    }

    const isInline = mode === 'inline';
    const originalFilename = data.originalFilename || `document.${data.fileType || 'pdf'}`;
    const safeFilename = sanitizeFilename(originalFilename, data.fileType || 'pdf');
    const contentType = data.mimeType || ALLOWED_TYPES[data.fileType as keyof typeof ALLOWED_TYPES];

    await writeRequiredAuditLog(db, {
      userId: context.uid,
      userRole: context.role,
      userName: context.name,
      action: 'export',
      collection: 'knowledge_bank',
      documentId: id,
      metadata: { mode: isInline ? 'inline' : 'attachment', originalFilename },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    const url = await getObjectStore().createSignedReadUrl(storagePath, {
      expiresMs: 15 * 60 * 1000,
      responseDisposition: isInline
        ? `inline; filename="${safeFilename}"`
        : `attachment; filename="${safeFilename}"`,
      ...(contentType ? { contentType } : {}),
    });

    if (!isInline) {
      try {
        await db
          .collection('knowledge_bank')
          .doc(id)
          .update({
            downloadCount: FieldValue.increment(1),
            lastDownloadedAt: new Date().toISOString(),
          });
      } catch (counterErr) {
        console.warn('[KnowledgeBank] Failed to update download counter:', counterErr);
      }
    }

    return res.status(200).json({ success: true, url });
  } catch (err) {
    const statusCode =
      typeof err === 'object' &&
      err !== null &&
      'statusCode' in err &&
      typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    console.error('[KnowledgeBank] Download error:', err);
    return res.status(statusCode).json({
      success: false,
      errorCode: statusCode >= 500 ? 'internal_error' : 'forbidden',
      error:
        statusCode === 503
          ? 'Download temporarily unavailable'
          : 'Failed to generate download URL',
    });
  }
}
