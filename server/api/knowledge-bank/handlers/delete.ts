import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { verifyAuthContext, getDb } from '../../lib/auth/verifyAuth.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { readJsonBody } from './utils.js';
import { authUserFromContext, staffActorFromContext } from '../../lib/auth/contextUser.js';
import { getObjectStore } from '../../lib/storage/objectStore.js';

export async function handleDelete(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'DELETE')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin', 'teacher']);
  if (!verified) return;
  const user = authUserFromContext(verified.context);
  const actor = staffActorFromContext(verified.context);

  let id: string | undefined;
  if (req.query.id) {
    id = req.query.id as string;
  } else {
    try {
      const body = await readJsonBody(req);
      id = body?.id;
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid request body' });
    }
  }

  if (!id) {
    return res.status(400).json({ success: false, error: 'Missing document id' });
  }

  try {
    const db = getDb();
    const doc = await db.collection('knowledge_bank').doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    const data = doc.data()!;

    const userRole = actor.role;
    if (data.uploadedBy !== user.uid && userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }

    if (data.storagePath) {
      await getObjectStore().delete(data.storagePath, { ignoreNotFound: true });
    }

    await db.collection('knowledge_bank').doc(id).delete();

    void writeAuditLog(db, {
      userId: user.uid,
      userRole: userRole || 'unknown',
      action: 'delete',
      collection: 'knowledge_bank',
      documentId: id,
      metadata: { title: data.title, originalFilename: data.originalFilename },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    await touchRealtimeEvent('knowledge-bank');

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[KnowledgeBank] Delete error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to delete document',
    });
  }
}
