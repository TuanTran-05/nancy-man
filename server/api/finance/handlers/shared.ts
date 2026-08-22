import {
  formatDateForZalo,
  sendServerPaymentConfirmation,
  type ServerPaymentConfirmPayload,
} from '../../lib/payments/tuitionPayments.js';
import { AUTOMATIC_PAYMENT_CONFIRMATIONS_ENABLED } from '../../lib/payments/paymentConfirmationPolicy.js';
import {
  compactDateKey,
  getNextCounterSequence,
  peekNextCounterSequence,
} from '../../lib/documentStore/counterSequence.js';
import { formatCoursePeriodForZalo } from '../../lib/zalo/zaloFormat.js';
import {
  finiteMoney as sharedFiniteMoney,
  ledgerRemaining as sharedLedgerRemaining,
} from '../../../../shared/money.js';

export const DISCOUNT_TYPES = new Set([
  'none',
  'first_prize',
  'second_prize',
  'full_waiver',
  'hardship',
  'custom',
]);

export async function getNextFinanceSequence(
  db: AppDocumentStore.DocumentStore,
  counterId: string,
  collectionName: 'receipts' | 'expenses',
  numberField: 'receiptNo' | 'expenseNo',
  prefix: string
): Promise<number> {
  return getNextCounterSequence(db, {
    counterId,
    collectionName,
    numberField,
    prefix,
  });
}

export async function previewNextFinanceSequence(
  db: AppDocumentStore.DocumentStore,
  counterId: string,
  collectionName: 'receipts' | 'expenses',
  numberField: 'receiptNo' | 'expenseNo',
  prefix: string
): Promise<number> {
  return peekNextCounterSequence(db, {
    counterId,
    collectionName,
    numberField,
    prefix,
  });
}

export function getDailyPrefix(kind: 'receipt' | 'expense'): { dateStr: string; prefix: string } {
  const dateStr = compactDateKey();
  return { dateStr, prefix: `${kind === 'receipt' ? 'PT' : 'PC'}-${dateStr}-` };
}

export async function generateReceiptNo(db: AppDocumentStore.DocumentStore): Promise<string> {
  const { dateStr, prefix } = getDailyPrefix('receipt');
  const seq = await getNextFinanceSequence(
    db,
    `receipts_${dateStr}`,
    'receipts',
    'receiptNo',
    prefix
  );
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export async function previewReceiptNo(db: AppDocumentStore.DocumentStore): Promise<string> {
  const { dateStr, prefix } = getDailyPrefix('receipt');
  const seq = await previewNextFinanceSequence(
    db,
    `receipts_${dateStr}`,
    'receipts',
    'receiptNo',
    prefix
  );
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export function finiteMoney(value: unknown): number {
  return sharedFiniteMoney(value);
}

export function ledgerRemaining(ledger: AppDocumentStore.DocumentData): number {
  return sharedLedgerRemaining(ledger);
}

export function getReceiptPhone(student: AppDocumentStore.DocumentData): string {
  return String(student.contact || student.phone || student.parentPhone || '');
}

export function formatCoursePeriod(cls: AppDocumentStore.DocumentData): string {
  return formatCoursePeriodForZalo(cls);
}

export async function buildReceiptPaymentPayload(
  db: AppDocumentStore.DocumentStore,
  receipt: AppDocumentStore.DocumentData
): Promise<ServerPaymentConfirmPayload | null> {
  const studentId = String(receipt.studentId || '');
  const classId = String(receipt.classId || '');
  if (!studentId || !classId) return null;

  const [studentSnap, classSnap] = await Promise.all([
    db.collection('students').doc(studentId).get(),
    db.collection('classes').doc(classId).get(),
  ]);
  const student = studentSnap.data() || {};
  const cls = classSnap.data() || {};
  const receivedDate = String(receipt.receivedDate || new Date().toISOString().slice(0, 10));

  return {
    phone: getReceiptPhone(student),
    studentName: String(student.name || receipt.studentName || ''),
    studentCode: String(student.code || student.studentId || ''),
    coursePeriod: formatCoursePeriod(cls),
    amount: Number(receipt.amountReceived || 0),
    receiptNo: String(receipt.receiptNo || ''),
    paymentDate: formatDateForZalo(receivedDate),
    studentId,
    classId,
    className: String(cls.name || receipt.className || ''),
    receivedDate,
  };
}

export async function sendReceiptPaymentConfirmation(
  db: AppDocumentStore.DocumentStore,
  receipt: AppDocumentStore.DocumentData
) {
  if (!AUTOMATIC_PAYMENT_CONFIRMATIONS_ENABLED) return;

  const payload = await buildReceiptPaymentPayload(db, receipt);
  if (!payload) return;
  await sendServerPaymentConfirmation(db, payload);
}
