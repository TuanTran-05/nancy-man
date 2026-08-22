import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import {
  FieldPath,
  getDocumentStore,
  type DocumentData,
  type DocumentStore,
  type Query,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from '@/server/db/documentStore.js';
import { finiteMoney } from '../shared/money.js';
import { siblingEntitlementFor } from '../shared/siblingScholarship.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SIBLING_ACCOUNTING_MIGRATION_ID = 'backfill-sibling-discount-accounting-v1';

export type BackfillReceiptRow = {
  id: string;
  status?: string;
  ledgerId?: string;
  siblingDiscount?: boolean;
  siblingDiscountAmount?: number;
  discountAmount?: number;
  originalAmount?: number;
};

export type BackfillLedgerRow = {
  id: string;
  amount?: number;
  siblingDiscountTotal?: number;
};

export type ReceiptPatch = { id: string; siblingDiscountAmount: number };
export type LedgerPatch = { id: string; siblingDiscountTotal: number };

/**
 * Infers the sibling portion of a legacy receipt's `discountAmount`.
 *
 * An explicit `siblingDiscountAmount` always wins and is capped by
 * `discountAmount` — a stale or corrupted explicit value can never claim more
 * than the receipt actually discounted. Without an explicit component, a
 * flagged legacy receipt infers 10% of `originalAmount`, again capped by
 * `discountAmount`. A receipt with no positive `discountAmount` infers zero —
 * there is nothing to attribute.
 */
export function inferLegacySiblingAmount(receipt: Omit<BackfillReceiptRow, 'id'>): number {
  const discountAmount = finiteMoney(receipt.discountAmount);
  if (discountAmount <= 0) return 0;

  const explicit = Math.max(0, finiteMoney(receipt.siblingDiscountAmount));
  if (explicit > 0) return Math.min(explicit, discountAmount);

  if (receipt.siblingDiscount !== true) return 0;
  const inferred = Math.round(Math.max(0, finiteMoney(receipt.originalAmount)) * 0.1);
  return Math.min(inferred, discountAmount);
}

/**
 * Builds the exact set of receipt and ledger document patches needed to bring
 * legacy sibling-flagged accounting up to the server-authoritative model.
 * Only posted, non-void receipts count towards a ledger's entitlement, and
 * the ledger total is capped at 10% of the ledger's own amount — a legacy
 * over-grant is corrected down, never compounded further.
 *
 * Idempotent: a document whose stored value already equals the computed
 * value produces no patch, so a rerun after `--apply` yields empty arrays.
 */
export function buildSiblingAccountingBackfill(
  receipts: readonly BackfillReceiptRow[],
  ledgers: readonly BackfillLedgerRow[]
): { receiptPatches: ReceiptPatch[]; ledgerPatches: LedgerPatch[] } {
  const receiptPatches: ReceiptPatch[] = [];
  const componentsByLedger = new Map<string, number>();

  for (const receipt of receipts) {
    if (receipt.status !== 'posted') continue;

    const inferred = inferLegacySiblingAmount(receipt);
    if (inferred <= 0) continue;

    const current = Math.max(0, finiteMoney(receipt.siblingDiscountAmount));
    if (inferred !== current) {
      receiptPatches.push({ id: receipt.id, siblingDiscountAmount: inferred });
    }

    const ledgerId = String(receipt.ledgerId || '').trim();
    if (!ledgerId) continue;
    componentsByLedger.set(ledgerId, (componentsByLedger.get(ledgerId) || 0) + inferred);
  }

  const ledgerPatches: LedgerPatch[] = [];
  for (const ledger of ledgers) {
    const summed = componentsByLedger.get(ledger.id) || 0;
    if (summed <= 0) continue;

    const capped = Math.min(summed, siblingEntitlementFor(finiteMoney(ledger.amount)));
    const current = Math.max(0, finiteMoney(ledger.siblingDiscountTotal));
    if (capped !== current) {
      ledgerPatches.push({ id: ledger.id, siblingDiscountTotal: capped });
    }
  }

  return { receiptPatches, ledgerPatches };
}

async function readAllDocuments(query: Query<DocumentData>, pageSize = 500) {
  const documents: QueryDocumentSnapshot<DocumentData>[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;

  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    documents.push(...snapshot.docs);
    if (snapshot.docs.length < pageSize) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }

  return documents;
}

export async function backfillSiblingDiscountAccounting({
  db,
  apply,
  maxBatchWrites = 400,
  log = console.log,
}: {
  db: DocumentStore;
  apply: boolean;
  maxBatchWrites?: number;
  log?: (message: string) => void;
}) {
  if (!Number.isInteger(maxBatchWrites) || maxBatchWrites < 1 || maxBatchWrites > 400) {
    throw new Error('maxBatchWrites must be an integer between 1 and 400');
  }

  const [receiptDocs, ledgerDocs] = await Promise.all([
    readAllDocuments(db.collection('receipts')),
    readAllDocuments(db.collection('course_fee_ledgers')),
  ]);

  const receipts: BackfillReceiptRow[] = receiptDocs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  }));
  const ledgers: BackfillLedgerRow[] = ledgerDocs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  }));

  const { receiptPatches, ledgerPatches } = buildSiblingAccountingBackfill(receipts, ledgers);

  if (apply) {
    let batch: WriteBatch = db.batch();
    let batchWrites = 0;
    const now = new Date().toISOString();

    const queueWrite = async (ref: AppDocumentStore.DocumentReference, data: Record<string, unknown>) => {
      batch.update(ref, {
        ...data,
        updatedAt: now,
        siblingAccountingMigrationId: SIBLING_ACCOUNTING_MIGRATION_ID,
      });
      batchWrites += 1;
      if (batchWrites >= maxBatchWrites) {
        await batch.commit();
        batch = db.batch();
        batchWrites = 0;
      }
    };

    for (const patch of receiptPatches) {
      await queueWrite(db.collection('receipts').doc(patch.id), {
        siblingDiscountAmount: patch.siblingDiscountAmount,
      });
    }
    for (const patch of ledgerPatches) {
      await queueWrite(db.collection('course_fee_ledgers').doc(patch.id), {
        siblingDiscountTotal: patch.siblingDiscountTotal,
      });
    }
    if (batchWrites > 0) await batch.commit();
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    scannedReceipts: receipts.length,
    scannedLedgers: ledgers.length,
    receiptPatchCount: receiptPatches.length,
    ledgerPatchCount: ledgerPatches.length,
    totalSiblingDong: ledgerPatches.reduce((sum, p) => sum + p.siblingDiscountTotal, 0),
  };
  log(JSON.stringify(summary, null, 2));
  return { receiptPatches, ledgerPatches, summary };
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

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
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
      privateKey: normalizePrivateKey(requiredEnv('FIREBASE_PRIVATE_KEY')),
    }),
  });
}

async function main() {
  loadLocalEnv();
  const app = initFirebase();
  await backfillSiblingDiscountAccounting({
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
