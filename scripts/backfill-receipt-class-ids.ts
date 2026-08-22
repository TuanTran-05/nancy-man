import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore, type WriteBatch } from '@/server/db/documentStore.js';
import { receiptClassIds } from '../shared/receiptAllocations';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type ReceiptClassIdsBackfillOperation = {
  receiptDocId: string;
  classIds: string[];
};

export type ReceiptClassIdsBackfillPlan = {
  scannedCount: number;
  skippedCount: number;
  operations: ReceiptClassIdsBackfillOperation[];
};

export function buildReceiptClassIdsBackfillPlan(
  receipts: Array<{ id: string; data: Record<string, unknown> }>
): ReceiptClassIdsBackfillPlan {
  const operations: ReceiptClassIdsBackfillOperation[] = [];
  let skippedCount = 0;

  for (const receipt of receipts) {
    if (Array.isArray(receipt.data.classIds)) {
      skippedCount += 1;
      continue;
    }
    const classIds = receiptClassIds({ classId: receipt.data.classId });
    if (classIds.length === 0) {
      skippedCount += 1;
      continue;
    }
    operations.push({ receiptDocId: receipt.id, classIds });
  }

  return { scannedCount: receipts.length, skippedCount, operations };
}

function assertBatchSize(maxBatchWrites: number) {
  if (!Number.isInteger(maxBatchWrites) || maxBatchWrites < 1 || maxBatchWrites > 400) {
    throw new Error('maxBatchWrites must be an integer between 1 and 400');
  }
}

export async function backfillReceiptClassIds(options: {
  db: DocumentStore;
  apply: boolean;
  startedAt?: string;
  maxBatchWrites?: number;
}) {
  const startedAt = options.startedAt || new Date().toISOString();
  const maxBatchWrites = options.maxBatchWrites ?? 400;
  assertBatchSize(maxBatchWrites);

  const receiptsSnap = await options.db.collection('receipts').get();
  const plan = buildReceiptClassIdsBackfillPlan(
    receiptsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }))
  );

  if (options.apply && plan.operations.length > 0) {
    let batch: WriteBatch = options.db.batch();
    let batchWrites = 0;
    for (const operation of plan.operations) {
      batch.update(options.db.collection('receipts').doc(operation.receiptDocId), {
        classIds: operation.classIds,
      });
      batchWrites += 1;
      if (batchWrites >= maxBatchWrites) {
        await batch.commit();
        batch = options.db.batch();
        batchWrites = 0;
      }
    }
    if (batchWrites > 0) await batch.commit();
  }

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        startTime: startedAt,
        scanned: plan.scannedCount,
        skipped: plan.skippedCount,
        planned: plan.operations.length,
        applied: options.apply ? plan.operations.length : 0,
        receiptIds: plan.operations.map((operation) => operation.receiptDocId),
      },
      null,
      2
    )
  );
  return plan;
}

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function initFirebase(): App {
  if (getApps().length) return getApps()[0];
  const servicePath = path.join(projectRoot, 'service-account-key.json');
  if (existsSync(servicePath)) {
    return initializeApp({ credential: cert(JSON.parse(readFileSync(servicePath, 'utf8'))) });
  }
  return initializeApp({
    credential: cert({
      projectId: requiredEnv('FIREBASE_PROJECT_ID'),
      clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: requiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  });
}

async function main() {
  loadLocalEnv();
  const app = initFirebase();
  await backfillReceiptClassIds({
    db: getDocumentStore(app, requiredEnv('FIRESTORE_DATABASE_ID')),
    apply: process.argv.includes('--apply'),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
