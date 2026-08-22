import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { Timestamp } from '@/server/db/documentStore.js';
import { verifyAuthContext, getDb } from '../../../lib/auth/verifyAuth.js';
import { authUserFromContext } from '../../../lib/auth/contextUser.js';
import {
  getPageCursor,
  getPageLimit,
  resolvePageCursor,
  runPaginatedQuery,
} from '../../../lib/http/pagination.js';
import { normalizePaymentForApi } from './shared.js';
import { createReadCache, readCacheKey } from '../../../lib/cache/readCache.js';

async function countQuery(query: AppDocumentStore.Query): Promise<number> {
  const countable = query as AppDocumentStore.Query & {
    count?: () => { get: () => Promise<{ data: () => { count?: number } }> };
  };
  if (typeof countable.count === 'function') {
    const snap = await countable.count().get();
    return Number(snap.data().count || 0);
  }
  const snap = await query.limit(2000).get();
  return snap.size;
}

async function getPaymentHealth(db: AppDocumentStore.DocumentStore) {
  const now = Date.now();
  const olderThan30m = Timestamp.fromMillis(now - 30 * 60 * 1000);
  const last24h = Timestamp.fromMillis(now - 24 * 60 * 60 * 1000);
  const [
    stuckPendingCount,
    needsReviewCount,
    createFailedCount,
    staleCreatingGatewaySession,
    failedWebhookCount24h,
    staleProcessingWebhookCount,
  ] = await Promise.all([
    countQuery(
      db
        .collection('payment_requests')
        .where('status', '==', 'pending')
        .where('createdAt', '<=', olderThan30m)
    ),
    countQuery(db.collection('payment_requests').where('status', '==', 'needs_review')),
    countQuery(db.collection('payment_requests').where('status', '==', 'create_failed')),
    countQuery(
      db
        .collection('payment_requests')
        .where('status', '==', 'creating_gateway_session')
        .where('createdAt', '<=', olderThan30m)
    ),
    countQuery(
      db
        .collection('webhook_events')
        .where('processingStatus', 'in', ['invalid_signature', 'orphan', 'needs_review', 'failed'])
        .where('receivedAt', '>=', last24h)
    ),
    countQuery(
      db
        .collection('webhook_events')
        .where('processingStatus', '==', 'processing')
        .where('leaseUntil', '<=', Timestamp.fromMillis(now))
    ),
  ]);

  return {
    stuckPendingCount,
    needsReviewCount,
    createFailedCount,
    staleCreatingGatewaySession,
    failedWebhookCount24h,
    staleProcessingWebhookCount,
    pendingOlderThan30m: stuckPendingCount,
    needsReviewOpen: needsReviewCount,
    failedWebhookEvents24h: failedWebhookCount24h,
  };
}

const EMPTY_PAYMENT_HEALTH = {
  stuckPendingCount: 0,
  needsReviewCount: 0,
  createFailedCount: 0,
  staleCreatingGatewaySession: 0,
  failedWebhookCount24h: 0,
  staleProcessingWebhookCount: 0,
  pendingOlderThan30m: 0,
  needsReviewOpen: 0,
  failedWebhookEvents24h: 0,
};

const paymentHealthCache = createReadCache<typeof EMPTY_PAYMENT_HEALTH>(15_000);

export async function handleList(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const verified = await verifyAuthContext(req, res, ['admin', 'accounting']);
  if (!verified) return;
  const user = authUserFromContext(verified.context);

  const db = getDb();
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const limit = getPageLimit(req, 2000, 2000);
  const cursor = getPageCursor(req);
  let query: AppDocumentStore.Query = db.collection('payment_requests');
  if (status && status !== 'all') query = query.where('status', '==', status);
  query = query.orderBy('createdAt', 'desc');

  const cursorDoc = cursor ? await resolvePageCursor(db, 'payment_requests', cursor) : null;
  const { docs, page } = await runPaginatedQuery(query, limit, cursorDoc);
  const payments = docs.map((doc) => normalizePaymentForApi(doc.id, doc.data()));

  const includeReceiptStatus = req.query.includeReceiptStatus === 'true';
  const receiptStatusMap = new Map<string, string>();
  if (includeReceiptStatus) {
    const receiptIds = payments.map((p) => p.receiptId).filter((id): id is string => !!id);
    if (receiptIds.length > 0) {
      const receiptRefs = receiptIds.map((id) => db.collection('receipts').doc(id));
      const receiptSnaps = await db.getAll(...receiptRefs);
      for (const rsnap of receiptSnaps) {
        if (rsnap.exists) {
          receiptStatusMap.set(rsnap.id, String(rsnap.data()?.status || ''));
        }
      }
    }
  }

  const enriched = payments.map((p) => ({
    ...p,
    receiptStatus:
      includeReceiptStatus && p.receiptId ? receiptStatusMap.get(p.receiptId) || null : null,
  }));

  let health = EMPTY_PAYMENT_HEALTH;
  try {
    const healthKey = readCacheKey({
      channel: 'payos-health',
      role: 'admin-accounting',
      params: { status: status || 'all' },
    });
    health = await paymentHealthCache.get(healthKey, () => getPaymentHealth(db));
  } catch (err) {
    console.error('[payOS] Failed to load payment health counts:', err);
  }

  return res.status(200).json({ success: true, payments: enriched, page, health });
}
