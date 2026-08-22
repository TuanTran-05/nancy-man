import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { and, asc, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import { appDocuments, jobs, notifications } from '../../../../db/drizzle/schema.js';
import type { SqlDatabase } from '../../../db/client.js';
import { requireRole, withAuthzStatus, type UserContext } from '../../lib/auth/authz.js';
import { ADMIN_DASHBOARD_LIMIT, getBoundedLimit, getCursor, getLimit } from './utils.js';

type JobRow = typeof jobs.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;

function isoTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid PostgreSQL timestamp');
  return date.toISOString();
}

function camelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function camelObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelObject);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [camelCase(key), camelObject(entry)])
  );
}

function documentData(row: { documentId: string; data: unknown }): Record<string, unknown> {
  const data =
    row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {};
  return { id: row.documentId, ...data };
}

function projectedNotificationData(row: { documentId: string; data: unknown }) {
  const data = documentData(row);
  const result: Record<string, unknown> = { id: row.documentId };
  for (const key of [
    'classId',
    'studentId',
    'studentName',
    'status',
    'date',
    'sessionId',
    'title',
    'type',
    'start',
    'end',
    'description',
    'location',
    'message',
  ]) {
    if (typeof data[key] === 'string' && data[key]) result[key] = data[key];
  }
  for (const key of ['isRead', 'createdAt', 'updatedAt']) {
    if (data[key] !== undefined) result[key] = data[key];
  }
  return result;
}

export function mapJobRow(row: JobRow, requesterName?: string): Record<string, unknown> {
  void requesterName;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    params: camelObject(row.params),
    result: camelObject(row.result),
    error: camelObject(row.error),
    attempts: row.attempts,
    requestedById: row.requestedById,
    requestedByRole: row.requestedByRole,
    startedAt: row.startedAt ? isoTimestamp(row.startedAt) : null,
    completedAt: row.completedAt ? isoTimestamp(row.completedAt) : null,
    durationMs: row.durationMs,
    schemaVersion: row.schemaVersion,
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
  };
}

export async function readJobsSql(database: SqlDatabase, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin', 'accounting']);
  const limit = getBoundedLimit(req, ADMIN_DASHBOARD_LIMIT, ADMIN_DASHBOARD_LIMIT);
  const cursor = getCursor(req);
  const createdAt = sql<string>`${appDocuments.data} ->> 'createdAt'`;
  const conditions: SQL[] = [eq(appDocuments.collectionPath, 'jobs')];

  if (cursor) {
    const [cursorRow] = await database
      .select({ createdAt })
      .from(appDocuments)
      .where(
        and(
          eq(appDocuments.collectionPath, 'jobs'),
          eq(appDocuments.documentId, cursor)
        )
      )
      .limit(1);
    if (cursorRow?.createdAt) conditions.push(lt(createdAt, cursorRow.createdAt));
  }

  const rows = await database
    .select({ documentId: appDocuments.documentId, data: appDocuments.data })
    .from(appDocuments)
    .where(and(...conditions))
    .orderBy(desc(createdAt), asc(appDocuments.documentId))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? pageRows.at(-1)?.documentId : undefined;

  return {
    jobs: pageRows.map(documentData),
    page: {
      limit,
      nextCursor: nextCursor || null,
      hasMore,
    },
  };
}

export function mapNotificationRow(
  row: NotificationRow,
  projection: 'scoped' | 'admin'
): Record<string, unknown> {
  if (projection === 'admin') {
    return {
      id: row.id,
      studentId: row.studentId,
      classId: row.classId,
      teacherId: row.teacherId,
      type: row.type,
      title: row.title,
      message: row.message,
      isRead: row.isRead,
      createdAt: isoTimestamp(row.createdAt),
      updatedAt: row.updatedAt ? isoTimestamp(row.updatedAt) : null,
    };
  }
  return {
    id: row.id,
    ...(row.classId !== null ? { classId: row.classId } : {}),
    studentId: row.studentId,
    type: row.type,
    title: row.title,
    message: row.message,
    isRead: row.isRead,
    createdAt: isoTimestamp(row.createdAt),
    ...(row.updatedAt !== null ? { updatedAt: isoTimestamp(row.updatedAt) } : {}),
  };
}

export async function readNotificationsSql(
  database: SqlDatabase,
  ctx: UserContext,
  req: ApiRequest
) {
  const limit = getLimit(req, 100);
  const conditions: SQL[] = [eq(appDocuments.collectionPath, 'notifications')];
  let projection: 'scoped' | 'admin' = 'scoped';

  if (ctx.role === 'student' || ctx.role === 'parent') {
    const studentId = String(ctx.studentId || '').trim();
    if (!studentId) throw withAuthzStatus('Student account is not linked', 403);
    conditions.push(eq(sql<string>`${appDocuments.data} ->> 'studentId'`, studentId));
  } else if (ctx.role === 'teacher') {
    conditions.push(eq(sql<string>`${appDocuments.data} ->> 'teacherId'`, ctx.uid));
  } else {
    requireRole(ctx, ['admin']);
    projection = 'admin';
  }

  const rows = await database
    .select({ documentId: appDocuments.documentId, data: appDocuments.data })
    .from(appDocuments)
    .where(and(...conditions))
    .orderBy(asc(appDocuments.documentId))
    .limit(limit);

  return {
    notifications: rows.map((row) =>
      projection === 'admin' ? documentData(row) : projectedNotificationData(row)
    ),
  };
}
