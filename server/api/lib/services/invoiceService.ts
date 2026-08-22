import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';

export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'void' | 'superseded';

export type InvoiceReservation = {
  created: boolean;
  invoiceId: string;
  invoiceNo: string;
  amountDue: number;
  status: InvoiceStatus;
  snapshotVersion: number;
};

type ReserveInvoiceInput = {
  ledgerId: string;
  studentId: string;
  classId: string;
  parentUid?: string;
  orderCode?: number;
  amountDue: number;
  ledger: Record<string, unknown>;
  studentName?: string;
  className?: string;
  now?: Date;
};

const ACTIVE_INVOICE_STATUSES: InvoiceStatus[] = ['issued', 'partially_paid'];
const INVOICE_SNAPSHOT_VERSION = 1;

function finiteMoney(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildInvoiceNo(input: { orderCode?: number; invoiceId: string; now: Date }): string {
  if (input.orderCode && Number.isFinite(input.orderCode)) return `INV-${input.orderCode}`;
  const dateKey = input.now.toISOString().slice(2, 10).replace(/-/g, '');
  return `INV-${dateKey}-${input.invoiceId.slice(0, 6).toUpperCase()}`;
}

function hasMatchingImmutableSnapshot(data: AppDocumentStore.DocumentData, amountDue: number) {
  return (
    Number(data.amountDue || 0) === amountDue &&
    String(data.currency || 'VND') === 'VND' &&
    Number(data.snapshotVersion || 0) === INVOICE_SNAPSHOT_VERSION
  );
}

export async function reserveInvoiceForPayment(
  tx: Transaction,
  db: DocumentStore,
  input: ReserveInvoiceInput
): Promise<InvoiceReservation> {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const invoiceQuery = db
    .collection('invoices')
    .where('ledgerId', '==', input.ledgerId)
    .where('status', 'in', ACTIVE_INVOICE_STATUSES)
    .limit(1);
  const existingSnap = await tx.get(invoiceQuery);
  const existingDoc = existingSnap.docs[0];
  const existingInvoice = existingDoc?.data() || null;

  if (
    existingDoc &&
    existingInvoice &&
    hasMatchingImmutableSnapshot(existingInvoice, input.amountDue)
  ) {
    return {
      created: false,
      invoiceId: existingDoc.id,
      invoiceNo: String(existingInvoice.invoiceNo || ''),
      amountDue: Number(existingInvoice.amountDue || 0),
      status: String(existingInvoice.status || 'issued') as InvoiceStatus,
      snapshotVersion: INVOICE_SNAPSHOT_VERSION,
    };
  }

  const invoiceRef = db.collection('invoices').doc();
  const invoiceNo = buildInvoiceNo({
    orderCode: input.orderCode,
    invoiceId: invoiceRef.id,
    now,
  });

  if (existingDoc) {
    tx.update(existingDoc.ref, {
      status: 'superseded' satisfies InvoiceStatus,
      supersededAt: nowIso,
      supersededByInvoiceId: invoiceRef.id,
      updatedAt: nowIso,
    });
  }

  const amountDue = finiteMoney(input.amountDue);
  const invoiceDoc = {
    invoiceNo,
    ledgerId: input.ledgerId,
    studentId: input.studentId,
    classId: input.classId,
    parentUid: input.parentUid || '',
    currency: 'VND',
    status: 'issued' satisfies InvoiceStatus,
    amountDue,
    amountPaid: 0,
    ledgerAmountSnapshot: finiteMoney(input.ledger.amount),
    paidTotalSnapshot: finiteMoney(input.ledger.paidTotal),
    discountTotalSnapshot: finiteMoney(input.ledger.discountTotal),
    studentSnapshot: { id: input.studentId, name: input.studentName || '' },
    classSnapshot: { id: input.classId, name: input.className || '' },
    lineItems: [
      {
        type: 'tuition',
        ledgerId: input.ledgerId,
        description: input.className || 'Tuition',
        amount: amountDue,
      },
    ],
    issuedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    snapshotVersion: INVOICE_SNAPSHOT_VERSION,
  };

  tx.create(invoiceRef, invoiceDoc);

  return {
    created: true,
    invoiceId: invoiceRef.id,
    invoiceNo,
    amountDue,
    status: 'issued',
    snapshotVersion: INVOICE_SNAPSHOT_VERSION,
  };
}
