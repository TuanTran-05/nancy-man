import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, deleteApp, initializeApp, type ServiceAccount } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { readAuditLog } from '../server/api/read/handlers/readers.js';
import { readAuditLogSql } from '../server/api/read/handlers/auditLogSql.js';
import type { UserContext } from '../server/api/lib/auth/authz.js';
import { closeSqlDb, getSqlDb } from '../server/db/client.js';

const [databaseId, startDate, endDate] = process.argv.slice(2);
if (!databaseId || !startDate || !endDate) {
  throw new Error(
    'Usage: tsx scripts/compare-audit-log-read.ts <documentStore-database-id> <start-date> <end-date>'
  );
}

const serviceAccountPath = resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'service-account-key.json'
);
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as ServiceAccount;
const firebaseApp = initializeApp(
  { credential: cert(serviceAccount) },
  `audit-log-parity-${Date.now()}`
);
const documentStore = getDocumentStore(firebaseApp, databaseId);
const adminContext: UserContext = { uid: 'parity-check', role: 'admin', name: 'Parity check' };

function request(query: Record<string, string>): ApiRequest {
  return { query } as unknown as ApiRequest;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);
}

function fieldDigests(value: Record<string, unknown>): string {
  const keys = new Set(Object.keys(value));
  return [...keys]
    .sort()
    .map((key) => `${key}:${typeof value[key]}:${digest(value[key])}`)
    .join(',');
}

type AuditPage = Awaited<ReturnType<typeof readAuditLogSql>>;

function assertParity(page: number, documentStorePage: AuditPage, postgresPage: AuditPage): void {
  const documentStoreDigest = digest(documentStorePage);
  const postgresDigest = digest(postgresPage);
  if (documentStoreDigest !== postgresDigest) {
    const documentStoreIds = documentStorePage.logs.map((log) => String(log.id));
    const postgresIds = postgresPage.logs.map((log) => String(log.id));
    const documentStoreIdSet = new Set(documentStoreIds);
    const postgresIdSet = new Set(postgresIds);
    const sharedIds = documentStoreIds.filter((id) => postgresIdSet.has(id));
    const mismatchAt = Math.max(
      0,
      documentStorePage.logs.findIndex((log, index) => digest(log) !== digest(postgresPage.logs[index]))
    );
    const documentStoreLog = documentStorePage.logs[mismatchAt] || {};
    const postgresLog = postgresPage.logs[mismatchAt] || {};
    throw new Error(
      `Page ${page} differs: documentStore=${documentStoreDigest}, postgres=${postgresDigest}, ` +
        `logs=${digest(documentStorePage.logs)}|${digest(postgresPage.logs)}, ` +
        `users=${digest(documentStorePage.users)}|${digest(postgresPage.users)}, ` +
        `page=${digest(documentStorePage.page)}|${digest(postgresPage.page)}, ` +
        `firstLog=${documentStoreIds[mismatchAt] || '-'}|${postgresIds[mismatchAt] || '-'}, ` +
        `pageIds=${documentStoreIds.length}|${postgresIds.length}, ` +
        `sharedIds=${sharedIds.length}, ` +
        `onlyDocumentStore=${documentStoreIds.filter((id) => !postgresIdSet.has(id)).slice(0, 5).join(',') || '-'}, ` +
        `onlyPostgres=${postgresIds.filter((id) => !documentStoreIdSet.has(id)).slice(0, 5).join(',') || '-'}, ` +
        `timestampRange=${String(documentStorePage.logs.at(0)?.timestamp || '-')}..${String(documentStorePage.logs.at(-1)?.timestamp || '-')}|` +
        `${String(postgresPage.logs.at(0)?.timestamp || '-')}..${String(postgresPage.logs.at(-1)?.timestamp || '-')}, ` +
        `fields=${fieldDigests(documentStoreLog)}|${fieldDigests(postgresLog)}`
    );
  }
  console.log(
    `OK page ${page}: ${documentStorePage.logs.length} logs, cursor=${documentStorePage.page.nextCursor || '-'}, digest=${documentStoreDigest}`
  );
}

try {
  let cursor = '';
  for (let page = 1; page <= 2; page += 1) {
    const query = {
      startDate,
      endDate,
      limit: '100',
      ...(cursor ? { cursor } : {}),
    };
    const [documentStorePage, postgresPage] = await Promise.all([
      readAuditLog(documentStore, adminContext, request(query)),
      readAuditLogSql(getSqlDb(), adminContext, request(query)),
    ]);
    assertParity(page, documentStorePage as AuditPage, postgresPage);
    cursor = documentStorePage.page.nextCursor || '';
    if (!cursor) break;
  }
} finally {
  await Promise.all([closeSqlDb(), deleteApp(firebaseApp)]);
}
