import type { ApiRequest } from '@/server/api/lib/http/types.js';

export type PageInfo = {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export function getPageLimit(req: ApiRequest, fallback = 50, max = 100): number {
  return Math.min(Math.max(Number(req.query.limit || fallback), 1), max);
}

export function getPageCursor(req: ApiRequest): string {
  return typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';
}

export async function resolvePageCursor(
  db: AppDocumentStore.DocumentStore,
  collection: string,
  cursor: string
): Promise<AppDocumentStore.DocumentSnapshot | null> {
  if (!cursor) return null;
  const doc = await db.collection(collection).doc(cursor).get();
  return doc.exists ? doc : null;
}

export async function runPaginatedQuery(
  query: AppDocumentStore.Query,
  limit: number,
  cursorDoc: AppDocumentStore.DocumentSnapshot | null
): Promise<{ docs: AppDocumentStore.QueryDocumentSnapshot[]; page: PageInfo }> {
  let q = query.limit(limit + 1);
  if (cursorDoc) q = q.startAfter(cursorDoc);

  const snap = await q.get();
  const hasMore = snap.docs.length > limit;
  const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
  return {
    docs,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && docs.length > 0 ? docs[docs.length - 1].id : null,
    },
  };
}
