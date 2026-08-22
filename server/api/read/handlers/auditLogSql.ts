import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { appDocuments, auditLogs, users as usersTable } from '../../../../db/drizzle/schema.js';
import type { SqlDatabase } from '../../../db/client.js';
import { requireRole, type UserContext } from '../../lib/auth/authz.js';
import { getCursor, getLimit } from './utils.js';
import { resolveAuditLogFilters } from './auditLogFilters.js';

type AuditLogRow = typeof auditLogs.$inferSelect;

function isoTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid audit timestamp in PostgreSQL');
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

export function mapAuditLogRow(row: AuditLogRow): Record<string, unknown> {
  const occurredAt = isoTimestamp(row.occurredAt);
  return {
    id: row.id,
    occurredAt,
    timestamp: occurredAt,
    userId: row.userId,
    userRole: row.userRole,
    userName: row.userName,
    action: row.action,
    entityTable: row.entityTable,
    collection: row.entityTable,
    entityId: row.entityId,
    documentId: row.entityId,
    ip: row.ip,
    userAgent: row.userAgent,
    changes: camelObject(row.changes),
    metadata: camelObject(row.metadata),
  };
}

export async function readAuditLogSql(database: SqlDatabase, ctx: UserContext, req: ApiRequest) {
  requireRole(ctx, ['admin']);
  const limit = getLimit(req, 100);
  const cursor = getCursor(req);
  const filters = resolveAuditLogFilters(req);
  const timestamp = sql<string>`${appDocuments.data} ->> 'timestamp'`;
  const conditions: SQL[] = [
    eq(appDocuments.collectionPath, 'audit_logs'),
    gte(timestamp, filters.startIso),
    lte(timestamp, filters.endIso),
  ];

  if (filters.action) {
    conditions.push(eq(sql<string>`${appDocuments.data} ->> 'action'`, filters.action));
  }
  if (filters.collectionName) {
    conditions.push(
      eq(sql<string>`${appDocuments.data} ->> 'collection'`, filters.collectionName)
    );
  }

  if (cursor) {
    const [cursorRow] = await database
      .select({ timestamp })
      .from(appDocuments)
      .where(
        and(
          eq(appDocuments.collectionPath, 'audit_logs'),
          eq(appDocuments.documentId, cursor)
        )
      )
      .limit(1);
    if (cursorRow?.timestamp) conditions.push(lt(timestamp, cursorRow.timestamp));
  }

  const rows = await database
    .select({ documentId: appDocuments.documentId, data: appDocuments.data })
    .from(appDocuments)
    .where(and(...conditions))
    .orderBy(desc(timestamp), asc(appDocuments.documentId))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? pageRows.at(-1)?.documentId : undefined;

  const logs: Array<{ id: string; [key: string]: unknown }> = pageRows.map((row) => {
    const data =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {};
    return { id: row.documentId, ...data };
  });

  const userIds = new Set<string>();
  for (const row of logs) {
    const userId = typeof row.userId === 'string' ? row.userId.trim() : '';
    const entityTable = typeof row.collection === 'string' ? row.collection : '';
    const entityId = typeof row.documentId === 'string' ? row.documentId.trim() : '';
    if (userId) userIds.add(userId);
    if (entityTable === 'users' && entityId) userIds.add(entityId);
  }

  const userRows =
    userIds.size > 0
      ? await database
          .select({
            id: usersTable.id,
            displayName: usersTable.displayName,
            email: usersTable.email,
            role: usersTable.role,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, [...userIds]))
      : [];
  const users: Record<string, { displayName?: string; email?: string; role?: string }> = {};
  for (const user of userRows) {
    users[user.id] = {
      displayName: user.displayName,
      ...(user.email !== null ? { email: user.email } : {}),
      role: user.role,
    };
  }

  return {
    logs,
    users,
    page: {
      limit,
      nextCursor: nextCursor || null,
      hasMore,
    },
  };
}
