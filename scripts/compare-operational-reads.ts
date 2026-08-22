import type { ApiRequest } from '@/server/api/lib/http/types.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, deleteApp, initializeApp, type ServiceAccount } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import type { UserContext } from '../server/api/lib/auth/authz.js';
import { readJobs, readNotifications } from '../server/api/read/handlers/readers.js';
import {
  readJobsSql,
  readNotificationsSql,
} from '../server/api/read/handlers/operationalReadsSql.js';
import { closeSqlDb, getSqlDb } from '../server/db/client.js';

const [databaseId] = process.argv.slice(2);
if (!databaseId) {
  throw new Error('Usage: tsx scripts/compare-operational-reads.ts <documentStore-database-id>');
}

const serviceAccountPath = resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'service-account-key.json'
);
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as ServiceAccount;
const firebaseApp = initializeApp(
  { credential: cert(serviceAccount) },
  `operational-read-parity-${Date.now()}`
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
  return JSON.stringify(value) ?? 'undefined';
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);
}

function canonicalNotificationPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const notifications = (value as { notifications?: unknown[] }).notifications;
  if (!Array.isArray(notifications)) return value;
  return {
    ...(value as Record<string, unknown>),
    notifications: [...notifications].sort((left, right) => {
      const leftId = String((left as { id?: unknown })?.id || '');
      const rightId = String((right as { id?: unknown })?.id || '');
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    }),
  };
}

function recordMismatchSummary(
  label: string,
  documentStoreValue: unknown,
  postgresValue: unknown
): string {
  const recordKey = label.startsWith('jobs ') ? 'jobs' : 'notifications';
  const documentStoreRecords =
    documentStoreValue && typeof documentStoreValue === 'object'
      ? (documentStoreValue as Record<string, unknown>)[recordKey]
      : undefined;
  const postgresRecords =
    postgresValue && typeof postgresValue === 'object'
      ? (postgresValue as Record<string, unknown>)[recordKey]
      : undefined;
  if (!Array.isArray(documentStoreRecords) || !Array.isArray(postgresRecords)) return '';

  const documentStoreById = new Map(
    documentStoreRecords.map((item) => [String((item as { id?: unknown })?.id || ''), item])
  );
  const postgresById = new Map(
    postgresRecords.map((item) => [String((item as { id?: unknown })?.id || ''), item])
  );
  const onlyDocumentStore = [...documentStoreById.keys()].filter((id) => !postgresById.has(id));
  const onlyPostgres = [...postgresById.keys()].filter((id) => !documentStoreById.has(id));
  const differingId = [...documentStoreById.keys()].find(
    (id) => postgresById.has(id) && digest(documentStoreById.get(id)) !== digest(postgresById.get(id))
  );
  const documentStoreRecord = differingId ? documentStoreById.get(differingId) : undefined;
  const postgresRecord = differingId ? postgresById.get(differingId) : undefined;
  const documentStoreKeys =
    documentStoreRecord && typeof documentStoreRecord === 'object'
      ? Object.keys(documentStoreRecord).sort().join(',')
      : '-';
  const postgresKeys =
    postgresRecord && typeof postgresRecord === 'object'
      ? Object.keys(postgresRecord).sort().join(',')
      : '-';
  const differingFields =
    documentStoreRecord &&
    typeof documentStoreRecord === 'object' &&
    postgresRecord &&
    typeof postgresRecord === 'object'
      ? [
          ...new Set([
            ...Object.keys(documentStoreRecord),
            ...Object.keys(postgresRecord),
          ]),
        ]
          .filter(
            (key) =>
              digest((documentStoreRecord as Record<string, unknown>)[key]) !==
              digest((postgresRecord as Record<string, unknown>)[key])
          )
          .sort()
          .join(',')
      : '-';
  const documentStoreUpdatedAtCount = documentStoreRecords.filter(
    (item) => item && typeof item === 'object' && 'updatedAt' in item
  ).length;
  const postgresUpdatedAtCount = postgresRecords.filter(
    (item) => item && typeof item === 'object' && 'updatedAt' in item
  ).length;
  const orderMismatchAt = documentStoreRecords.findIndex(
    (item, index) =>
      String((item as { id?: unknown })?.id || '') !==
      String((postgresRecords[index] as { id?: unknown } | undefined)?.id || '')
  );
  const orderMismatch =
    orderMismatchAt >= 0
      ? `${orderMismatchAt}:` +
        `${String((documentStoreRecords[orderMismatchAt] as { id?: unknown })?.id || '-')}|` +
        `${String((postgresRecords[orderMismatchAt] as { id?: unknown } | undefined)?.id || '-')}`
      : '-';

  return (
    ` counts=${documentStoreRecords.length}|${postgresRecords.length};` +
    ` onlyDocumentStore=${onlyDocumentStore.slice(0, 5).join(',') || '-'};` +
    ` onlyPostgres=${onlyPostgres.slice(0, 5).join(',') || '-'};` +
    ` firstDifferent=${differingId || '-'};` +
    ` keys=${documentStoreKeys}|${postgresKeys};` +
    ` fields=${differingFields || '-'};` +
    ` updatedAtPresence=${documentStoreUpdatedAtCount}|${postgresUpdatedAtCount};` +
    ` orderMismatch=${orderMismatch}`
  );
}

function assertParity(label: string, documentStoreValue: unknown, postgresValue: unknown): void {
  // The legacy DocumentStore notification query has no orderBy, so array order is
  // explicitly not part of its contract. Consumers sort by createdAt. Compare
  // this channel as an id-keyed set while keeping strict ordering for jobs.
  const unorderedNotifications = label.startsWith('notifications ');
  const documentStoreComparable = unorderedNotifications
    ? canonicalNotificationPayload(documentStoreValue)
    : documentStoreValue;
  const postgresComparable = unorderedNotifications
    ? canonicalNotificationPayload(postgresValue)
    : postgresValue;
  const documentStoreDigest = digest(documentStoreComparable);
  const postgresDigest = digest(postgresComparable);
  if (documentStoreDigest !== postgresDigest) {
    throw new Error(
      `${label} differs: documentStore=${documentStoreDigest}, postgres=${postgresDigest}. ` +
        recordMismatchSummary(label, documentStoreValue, postgresValue) +
        ' ' +
        'Regenerate the final snapshot or fix the SQL response projection before enabling it.'
    );
  }
  console.log(`OK ${label}: digest=${documentStoreDigest}`);
}

try {
  let cursor = '';
  for (let page = 1; page <= 2; page += 1) {
    const query = { limit: '100', ...(cursor ? { cursor } : {}) };
    const [documentStorePage, postgresPage] = await Promise.all([
      readJobs(documentStore, adminContext, request(query)),
      readJobsSql(getSqlDb(), adminContext, request(query)),
    ]);
    assertParity(`jobs page ${page}`, documentStorePage, postgresPage);
    cursor = documentStorePage.page.nextCursor || '';
    if (!cursor) break;
  }

  const notificationRequest = request({ limit: '2000' });
  const [documentStoreNotifications, postgresNotifications] = await Promise.all([
    readNotifications(documentStore, adminContext, notificationRequest),
    readNotificationsSql(getSqlDb(), adminContext, notificationRequest),
  ]);
  assertParity('notifications admin projection', documentStoreNotifications, postgresNotifications);
} finally {
  await Promise.all([closeSqlDb(), deleteApp(firebaseApp)]);
}
