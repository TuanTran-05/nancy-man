import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore, type WriteBatch } from '@/server/db/documentStore.js';
import { finiteMoney } from '../shared/money';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type WalletOpeningSnapshotOperation = {
  studentDocId: string;
  walletHistoryStartedAt: string;
  walletOpeningBalance: number;
};

export type WalletOpeningSnapshotPlan = {
  scannedCount: number;
  skippedCount: number;
  operations: WalletOpeningSnapshotOperation[];
};

export function buildWalletOpeningSnapshotPlan(
  students: Array<{ id: string; data: Record<string, unknown> }>,
  startedAt: string
): WalletOpeningSnapshotPlan {
  const operations: WalletOpeningSnapshotOperation[] = [];
  let skippedCount = 0;

  for (const student of students) {
    if (String(student.data.walletHistoryStartedAt || '').trim()) {
      skippedCount += 1;
      continue;
    }
    operations.push({
      studentDocId: student.id,
      walletHistoryStartedAt: startedAt,
      walletOpeningBalance: finiteMoney(student.data.walletBalance),
    });
  }

  return { scannedCount: students.length, skippedCount, operations };
}

function assertBatchSize(maxBatchWrites: number) {
  if (!Number.isInteger(maxBatchWrites) || maxBatchWrites < 1 || maxBatchWrites > 400) {
    throw new Error('maxBatchWrites must be an integer between 1 and 400');
  }
}

export async function snapshotWalletHistoryOpening(options: {
  db: DocumentStore;
  apply: boolean;
  startedAt?: string;
  maxBatchWrites?: number;
}) {
  const startedAt = options.startedAt || new Date().toISOString();
  const maxBatchWrites = options.maxBatchWrites ?? 400;
  assertBatchSize(maxBatchWrites);

  const studentsSnap = await options.db.collection('students').get();
  const plan = buildWalletOpeningSnapshotPlan(
    studentsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
    startedAt
  );

  if (options.apply && plan.operations.length > 0) {
    const pendingStudentIds = new Set(plan.operations.map((operation) => operation.studentDocId));
    const transactionSnap = await options.db.collection('wallet_transactions').get();
    const studentsWithV2Traffic = [
      ...new Set(
        transactionSnap.docs
          .map((doc) => doc.data() || {})
          .filter(
            (transaction) =>
              Number(transaction.schemaVersion) === 2 &&
              pendingStudentIds.has(String(transaction.studentId || ''))
          )
          .map((transaction) => String(transaction.studentId))
      ),
    ].sort();
    if (studentsWithV2Traffic.length > 0) {
      throw new Error(
        `Refusing to create wallet openings after v2 traffic for students: ${studentsWithV2Traffic.join(
          ', '
        )}`
      );
    }

    let batch: WriteBatch = options.db.batch();
    let batchWrites = 0;
    for (const operation of plan.operations) {
      batch.update(options.db.collection('students').doc(operation.studentDocId), {
        walletHistoryStartedAt: operation.walletHistoryStartedAt,
        walletOpeningBalance: operation.walletOpeningBalance,
        updatedAt: new Date().toISOString(),
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
        studentIds: plan.operations.map((operation) => operation.studentDocId),
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
  await snapshotWalletHistoryOpening({
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
