import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore, type WriteBatch } from '@/server/db/documentStore.js';
import {
  computeWalletBalance,
  computeWalletBalanceFromOpening,
  type WalletTransactionLike,
} from '../shared/wallet';
import { finiteMoney } from '../shared/money';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type WalletReconcileOperation = {
  studentDocId: string;
  cachedBalance: number;
  computedBalance: number;
  unsafeReason?: 'negative_computed_balance' | 'missing_opening_for_mixed_history';
};

export type WalletReconcilePlan = {
  scannedStudents: number;
  mismatchCount: number;
  unsafeCount: number;
  operations: WalletReconcileOperation[];
};

export function buildWalletReconcilePlan(
  students: Array<{ id: string; data: Record<string, unknown> }>,
  transactions: Array<WalletTransactionLike & { studentId?: unknown; schemaVersion?: unknown }>
): WalletReconcilePlan {
  type ReconcileTransaction = WalletTransactionLike & {
    studentId?: unknown;
    schemaVersion?: unknown;
  };
  const txByStudent = new Map<string, ReconcileTransaction[]>();
  for (const tx of transactions) {
    const studentId = String(tx.studentId || '');
    if (!studentId) continue;
    const list = txByStudent.get(studentId) || [];
    list.push(tx);
    txByStudent.set(studentId, list);
  }

  const operations: WalletReconcileOperation[] = [];
  for (const student of students) {
    const cachedBalance = finiteMoney(student.data.walletBalance);
    const studentTransactions = txByStudent.get(student.id) || [];
    const v2Transactions = studentTransactions.filter(
      (transaction) => Number(transaction.schemaVersion) === 2
    );
    const legacyTransactions = studentTransactions.filter(
      (transaction) => Number(transaction.schemaVersion) !== 2
    );
    const hasOpening = Boolean(String(student.data.walletHistoryStartedAt || '').trim());

    let computedBalance: number;
    let unsafeReason: WalletReconcileOperation['unsafeReason'];
    if (hasOpening) {
      computedBalance = computeWalletBalanceFromOpening(
        finiteMoney(student.data.walletOpeningBalance),
        v2Transactions
      );
    } else if (legacyTransactions.length > 0 && v2Transactions.length > 0) {
      computedBalance = computeWalletBalance(studentTransactions);
      unsafeReason = 'missing_opening_for_mixed_history';
    } else if (v2Transactions.length > 0) {
      computedBalance = computeWalletBalanceFromOpening(0, v2Transactions);
    } else {
      computedBalance = computeWalletBalance(legacyTransactions);
    }

    if (!unsafeReason && computedBalance < 0) {
      unsafeReason = 'negative_computed_balance';
    }
    if (cachedBalance !== computedBalance || unsafeReason) {
      operations.push({
        studentDocId: student.id,
        cachedBalance,
        computedBalance,
        ...(unsafeReason ? { unsafeReason } : {}),
      });
    }
  }
  return {
    scannedStudents: students.length,
    mismatchCount: operations.length,
    unsafeCount: operations.filter((operation) => operation.unsafeReason).length,
    operations,
  };
}

export async function reconcileWalletBalances(options: {
  db: DocumentStore;
  fix: boolean;
  maxBatchWrites?: number;
}) {
  const maxBatchWrites = options.maxBatchWrites ?? 400;
  if (!Number.isInteger(maxBatchWrites) || maxBatchWrites < 1 || maxBatchWrites > 400) {
    throw new Error('maxBatchWrites must be an integer between 1 and 400');
  }

  const [studentsSnap, txSnap] = await Promise.all([
    options.db.collection('students').get(),
    options.db.collection('wallet_transactions').get(),
  ]);
  const plan = buildWalletReconcilePlan(
    studentsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
    txSnap.docs.map((doc) => doc.data() || {})
  );

  if (
    options.fix &&
    plan.operations.some((operation) => operation.unsafeReason === 'negative_computed_balance')
  ) {
    throw new Error('Refusing --fix because one or more computed wallet balances are negative');
  }

  const repairOperations = plan.operations.filter((operation) => !operation.unsafeReason);
  if (options.fix && repairOperations.length > 0) {
    let batch: WriteBatch = options.db.batch();
    let batchWrites = 0;
    for (const op of repairOperations) {
      batch.update(options.db.collection('students').doc(op.studentDocId), {
        walletBalance: op.computedBalance,
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
        mode: options.fix ? 'fix' : 'dry-run',
        scannedStudents: plan.scannedStudents,
        mismatchCount: plan.mismatchCount,
        unsafeCount: plan.unsafeCount,
        operations: process.argv.includes('--verbose') ? plan.operations : undefined,
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
  const plan = await reconcileWalletBalances({
    db: getDocumentStore(app, requiredEnv('FIRESTORE_DATABASE_ID')),
    fix: process.argv.includes('--fix'),
  });
  if (plan.unsafeCount > 0) process.exitCode = 1;
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
