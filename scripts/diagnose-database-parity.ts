import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  cert,
  deleteApp,
  getDocumentStore,
  initializeApp,
  type ServiceAccount,
} from '@/server/db/documentStore.js';
import { resolveAuditLogFilters } from '../server/api/read/handlers/auditLogFilters.js';

const [databaseId, startDate, endDate] = process.argv.slice(2);
if (!databaseId || !startDate || !endDate) {
  throw new Error(
    'Usage: tsx scripts/diagnose-database-parity.ts <documentStore-database-id> <start-date> <end-date>'
  );
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const serviceAccountPath = resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'service-account-key.json'
);
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as ServiceAccount;
const firebaseApp = initializeApp(
  { credential: cert(serviceAccount) },
  `database-parity-diagnostic-${Date.now()}`
);
const documentStore = getDocumentStore(firebaseApp, databaseId);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

function countBy(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function valueShape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return depth >= 3 ? `array(${value.length})` : value.slice(0, 3).map((entry) => valueShape(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    const constructorName = (value as { constructor?: { name?: string } }).constructor?.name || 'Object';
    if (depth >= 3) return `${constructorName}{${Object.keys(value).sort().join(',')}}`;
    return {
      $type: constructorName,
      ...Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, valueShape(entry, depth + 1)])
      ),
    };
  }
  return typeof value;
}

try {
  const filters = resolveAuditLogFilters({ query: { startDate, endDate } } as never);
  const [auditSnapshot, postgresAudit, jobsSnapshot, postgresJobs] = await Promise.all([
    documentStore
      .collection('audit_logs')
      .where('timestamp', '>=', filters.startIso)
      .where('timestamp', '<=', filters.endIso)
      .get(),
    pool.query<{
      id: string;
      occurred_at: Date | string;
      user_id: string;
      user_role: string;
      user_name: string | null;
      action: string;
      entity_table: string;
      entity_id: string;
      ip: string | null;
      user_agent: string | null;
      changes: unknown;
      metadata: unknown;
    }>(
      `select id, occurred_at, user_id, user_role, user_name, action, entity_table, entity_id,
              ip, user_agent, changes, metadata
         from audit_logs
        where occurred_at >= $1 and occurred_at <= $2
        order by occurred_at desc, id desc`,
      [filters.startIso, filters.endIso]
    ),
    documentStore.collection('jobs').get(),
    pool.query<{
      id: string;
      requested_by_id: string | null;
      requested_by_role: string | null;
      error: unknown;
      status: string;
    }>('select id, requested_by_id, requested_by_role, error, status from jobs'),
  ]);

  const sourceAudit = new Map(
    auditSnapshot.docs.map((doc) => [doc.id, doc.data() as Record<string, unknown>])
  );
  const sqlAudit = new Map(postgresAudit.rows.map((row) => [row.id, row]));
  const onlySourceAudit = [...sourceAudit.keys()].filter((id) => !sqlAudit.has(id));
  const onlySqlAudit = [...sqlAudit.keys()].filter((id) => !sourceAudit.has(id));
  const sharedAudit = [...sourceAudit.keys()].filter((id) => sqlAudit.has(id));
  const auditFieldPresence = Object.fromEntries(
    ['occurredAt', 'entityTable', 'entityId', 'timestamp', 'collection', 'documentId', 'changes'].map(
      (field) => [field, sharedAudit.filter((id) => hasOwn(sourceAudit.get(id)!, field)).length]
    )
  );
  const auditChangesShapes = sharedAudit.map((id) => {
    const row = sourceAudit.get(id)!;
    if (!hasOwn(row, 'changes')) return 'absent';
    if (row.changes === null) return 'null';
    if (Array.isArray(row.changes)) return 'array';
    return typeof row.changes;
  });
  const auditKeyShapes = countBy(
    sharedAudit.map((id) => Object.keys(sourceAudit.get(id)!).sort().join(','))
  );
  const auditProjectionMismatchCounts: Record<string, number> = {};
  const auditMetadataMismatchShapes: Array<Record<string, unknown>> = [];
  for (const id of sharedAudit) {
    const source = sourceAudit.get(id)!;
    const sql = sqlAudit.get(id)!;
    const occurredAt =
      sql.occurred_at instanceof Date
        ? sql.occurred_at.toISOString()
        : new Date(sql.occurred_at).toISOString();
    const projection: Record<string, unknown> = {
      id: sql.id,
      occurredAt,
      timestamp: occurredAt,
      userId: sql.user_id,
      userRole: sql.user_role,
      userName: sql.user_name,
      action: sql.action,
      entityTable: sql.entity_table,
      collection: sql.entity_table,
      entityId: sql.entity_id,
      documentId: sql.entity_id,
      ip: sql.ip,
      userAgent: sql.user_agent,
      changes: sql.changes,
      metadata: sql.metadata,
    };
    for (const field of Object.keys(projection)) {
      if (canonical(source[field]) !== canonical(projection[field])) {
        auditProjectionMismatchCounts[field] = (auditProjectionMismatchCounts[field] || 0) + 1;
        if (field === 'metadata' && auditMetadataMismatchShapes.length < 10) {
          auditMetadataMismatchShapes.push({
            id,
            source: valueShape(source[field]),
            postgres: valueShape(projection[field]),
          });
        }
      }
    }
  }

  const sourceJobs = new Map(
    jobsSnapshot.docs.map((doc) => [doc.id, doc.data() as Record<string, unknown>])
  );
  const sqlJobs = new Map(postgresJobs.rows.map((row) => [row.id, row]));
  const sharedJobs = [...sourceJobs.keys()].filter((id) => sqlJobs.has(id));
  const legacyRequesterJobs = sharedJobs.filter((id) => {
    const row = sourceJobs.get(id)!;
    return hasOwn(row, 'requestedById') || hasOwn(row, 'requestedByRole');
  });
  const nestedRequesterJobs = sharedJobs.filter((id) => hasOwn(sourceJobs.get(id)!, 'requestedBy'));
  const requesterValueMissingInSql = legacyRequesterJobs.filter((id) => {
    const source = sourceJobs.get(id)!;
    const sql = sqlJobs.get(id)!;
    return (
      String(source.requestedById || '') !== String(sql.requested_by_id || '') ||
      String(source.requestedByRole || '') !== String(sql.requested_by_role || '')
    );
  });
  const sourceErrorShapes = sharedJobs.map((id) => {
    const row = sourceJobs.get(id)!;
    if (!hasOwn(row, 'error')) return 'absent';
    if (row.error === null) return 'null';
    if (Array.isArray(row.error)) return 'array';
    return typeof row.error;
  });
  const sqlErrorShapes = postgresJobs.rows.map((row) => {
    if (row.error === null) return 'null';
    if (Array.isArray(row.error)) return 'array';
    return typeof row.error;
  });

  console.log(
    JSON.stringify(
      {
        audit: {
          range: [filters.startIso, filters.endIso],
          sourceCount: sourceAudit.size,
          postgresCount: sqlAudit.size,
          sharedCount: sharedAudit.length,
          sharedSourceFieldPresence: auditFieldPresence,
          sharedSourceChangesShapes: countBy(auditChangesShapes),
          sharedSourceKeyShapes: auditKeyShapes,
          sharedProjectionMismatchCounts: auditProjectionMismatchCounts,
          metadataMismatchShapes: auditMetadataMismatchShapes,
          onlySource: onlySourceAudit.slice(0, 20).map((id) => {
            const row = sourceAudit.get(id)!;
            const metadata =
              row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
                ? Object.keys(row.metadata as Record<string, unknown>).sort()
                : [];
            return {
              id,
              timestamp: row.timestamp,
              action: row.action,
              collection: row.collection,
              metadataKeys: metadata,
            };
          }),
          onlyPostgres: onlySqlAudit.slice(0, 20).map((id) => {
            const row = sqlAudit.get(id)!;
            return {
              id,
              timestamp:
                row.occurred_at instanceof Date
                  ? row.occurred_at.toISOString()
                  : new Date(row.occurred_at).toISOString(),
              action: row.action,
              collection: row.entity_table,
            };
          }),
        },
        jobs: {
          sourceCount: sourceJobs.size,
          postgresCount: sqlJobs.size,
          onlySource: [...sourceJobs.keys()].filter((id) => !sqlJobs.has(id)).slice(0, 20),
          onlyPostgres: [...sqlJobs.keys()].filter((id) => !sourceJobs.has(id)).slice(0, 20),
          sourceRequesterShapes: {
            legacyTopLevel: legacyRequesterJobs.length,
            nested: nestedRequesterJobs.length,
          },
          requesterValueMissingInPostgresCount: requesterValueMissingInSql.length,
          requesterValueMissingInPostgresIds: requesterValueMissingInSql.slice(0, 20),
          sourceErrorShapes: countBy(sourceErrorShapes),
          postgresErrorShapes: countBy(sqlErrorShapes),
          sourceStatuses: countBy(sharedJobs.map((id) => String(sourceJobs.get(id)!.status || ''))),
          postgresStatuses: countBy(postgresJobs.rows.map((row) => row.status)),
        },
      },
      null,
      2
    )
  );
} finally {
  await Promise.all([pool.end(), deleteApp(firebaseApp)]);
}
