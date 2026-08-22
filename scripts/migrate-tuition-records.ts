import { writeFileSync } from 'node:fs';
import {
  FieldValue,
  getDocumentStore,
  type DocumentStore,
  type WriteBatch,
} from '@/server/db/documentStore.js';

type TuitionRecord = {
  studentId?: string;
  classId?: string;
  teacherId?: string;
  month?: string;
  amount?: number;
  paid?: number;
  status?: 'unpaid' | 'partial' | 'paid' | 'waived';
  dueDate?: string;
  note?: string;
  migrationStatus?: string;
  migratedToLedgerId?: string;
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const runId = `tuition_migration_${new Date().toISOString().replace(/[:.]/g, '-')}`;
const manifestPath =
  process.argv.find((arg) => arg.startsWith('--manifest='))?.slice('--manifest='.length) ||
  `migration-manifest-${runId}.json`;

function getDb(): DocumentStore {
  return getDocumentStore();
}

function ledgerIdFor(recordId: string): string {
  return `legacy_${recordId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function receiptIdFor(recordId: string): string {
  return `migration_${recordId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function flush(db: DocumentStore, batch: WriteBatch, ops: number) {
  if (ops > 0) await batch.commit();
  return { batch: db.batch(), ops: 0 };
}

async function main() {
  const db = getDb();
  const snap = await db.collection('tuition_records').get();
  const manifest: Record<string, unknown> = {
    runId,
    mode: apply ? 'apply' : 'dry-run',
    startedAt: new Date().toISOString(),
    total: snap.size,
    createdLedgers: 0,
    createdReceipts: 0,
    skippedAlreadyMigrated: 0,
    skippedInvalid: 0,
    records: [],
  };
  const records = manifest.records as Array<Record<string, unknown>>;

  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const record = doc.data() as TuitionRecord;
    if (record.migrationStatus === 'migrated' && record.migratedToLedgerId) {
      manifest.skippedAlreadyMigrated = Number(manifest.skippedAlreadyMigrated) + 1;
      records.push({ id: doc.id, action: 'skip_already_migrated' });
      continue;
    }
    if (!record.studentId || !record.classId || !record.month || Number(record.amount || 0) < 0) {
      manifest.skippedInvalid = Number(manifest.skippedInvalid) + 1;
      records.push({ id: doc.id, action: 'skip_invalid' });
      continue;
    }

    const ledgerId = ledgerIdFor(doc.id);
    const receiptId = receiptIdFor(doc.id);
    const amount = Number(record.amount || 0);
    const paid = Number(record.paid || 0);
    const status =
      record.status || (paid >= amount && amount > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
    const ledgerRef = db.collection('course_fee_ledgers').doc(ledgerId);
    const receiptRef = db.collection('receipts').doc(receiptId);
    const ledgerSnap = await ledgerRef.get();
    const receiptSnap = await receiptRef.get();
    const shouldCreateReceipt = paid > 0 || status === 'waived';

    records.push({
      id: doc.id,
      action: 'migrate',
      ledgerId,
      receiptId: shouldCreateReceipt ? receiptId : null,
      studentId: record.studentId,
      classId: record.classId,
      month: record.month,
      amount,
      paid,
      status,
    });

    if (!apply) continue;

    if (!ledgerSnap.exists) {
      batch.set(ledgerRef, {
        studentId: record.studentId,
        classId: record.classId,
        amount,
        paidTotal: status === 'waived' ? 0 : paid,
        discountTotal: status === 'waived' ? amount : 0,
        status,
        source: 'legacy_tuition',
        periodType: 'monthly',
        month: record.month,
        legacyTuitionRecordId: doc.id,
        migrationRunId: runId,
        note: record.note || '',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      });
      manifest.createdLedgers = Number(manifest.createdLedgers) + 1;
      ops++;
    }

    if (shouldCreateReceipt && !receiptSnap.exists) {
      batch.set(receiptRef, {
        receiptNo: `MIG-${doc.id}`.slice(0, 40),
        type: 'tuition',
        studentId: record.studentId,
        classId: record.classId,
        ledgerId,
        amountReceived: status === 'waived' ? 0 : paid,
        paymentMethod: 'other',
        receivedDate: record.dueDate || `${record.month}-01`,
        createdBy: 'migration',
        createdByRole: 'system',
        createdByName: 'Migration',
        status: 'posted',
        source: 'migration',
        discountType: status === 'waived' ? 'full_waiver' : 'none',
        discountAmount: status === 'waived' ? amount : 0,
        note: `Migrated from tuition_records/${doc.id}`,
        legacyTuitionRecordId: doc.id,
        migrationRunId: runId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      });
      manifest.createdReceipts = Number(manifest.createdReceipts) + 1;
      ops++;
    }

    batch.set(
      doc.ref,
      {
        migrationStatus: 'migrated',
        migratedToLedgerId: ledgerId,
        migratedToReceiptId: shouldCreateReceipt ? receiptId : null,
        migrationRunId: runId,
        migratedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    ops++;

    if (ops >= 430) ({ batch, ops } = await flush(db, batch, ops));
  }

  if (apply) await flush(db, batch, ops);
  manifest.finishedAt = new Date().toISOString();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ success: true, apply, manifestPath, runId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
