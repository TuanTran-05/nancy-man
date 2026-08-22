import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { getZaloConfig, sendZaloZNSMessage } from '../zalo/zaloHelper.js';
import { formatDateForZalo } from '../zalo/zaloFormat.js';
import { compactDateKey, getNextCounterSequence } from '../documentStore/counterSequence.js';
import { ledgerRemaining } from '../../../../shared/money.js';
import { normalizePhoneVN } from '../../../../shared/phone.js';
import { createZaloPayloadSnapshot } from '../../zalo/helpers/zaloTemplatePolicy.js';

function getDailyPrefix(kind: 'receipt' | 'payos'): { dateStr: string; prefix: string } {
  const dateStr = compactDateKey();
  return {
    dateStr,
    prefix: kind === 'receipt' ? `PT-${dateStr}-` : dateStr,
  };
}

export async function getNextReceiptNumber(db: DocumentStore): Promise<string> {
  const { dateStr, prefix } = getDailyPrefix('receipt');
  const seq = await getNextCounterSequence(db, {
    counterId: `receipts_${dateStr}`,
    collectionName: 'receipts',
    numberField: 'receiptNo',
    prefix,
  });
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export async function getNextPayOSOrderCode(db: DocumentStore): Promise<number> {
  const { dateStr } = getDailyPrefix('payos');
  const seq = await getNextCounterSequence(db, {
    counterId: `payos_orders_${dateStr}`,
    collectionName: 'payment_requests',
    numberField: 'orderCode',
    prefix: dateStr,
    lookupExisting: false,
  });
  return Number(`${dateStr}${String(seq).padStart(4, '0')}`);
}

export function getRemainingTuition(ledger: AppDocumentStore.DocumentData): number {
  return ledgerRemaining(ledger);
}

export interface ServerPaymentConfirmPayload {
  phone: string;
  studentName: string;
  studentCode: string;
  coursePeriod: string;
  amount: number;
  receiptNo: string;
  paymentDate: string;
  studentId: string;
  classId: string;
  className: string;
  receivedDate: string;
}

export async function sendServerPaymentConfirmation(
  db: DocumentStore,
  payload: ServerPaymentConfirmPayload
): Promise<void> {
  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret || !cfg.znsPaymentTemplateId || !payload.phone) {
    await logZaloPayment(
      db,
      payload,
      'failed',
      '',
      !cfg.znsPaymentTemplateId
        ? 'ZALO_ZNS_PAYMENT_TEMPLATE_ID is not configured'
        : 'Zalo OA is not configured',
      { payloadCaptured: false }
    );
    return;
  }

  const phone = normalizePhoneVN(payload.phone);
  const templateData = {
    ten_hoc_vien: payload.studentName,
    ma_hoc_vien: payload.studentCode || '',
    ten_khoa_hoc: payload.coursePeriod || '',
    so_tien: Number(payload.amount) || 0,
    ma_giao_dich: payload.receiptNo,
    ngay_thanh_toan: payload.paymentDate,
  };
  const result = await sendZaloZNSMessage(
    cfg.znsPaymentTemplateId,
    templateData,
    phone,
    `edutrack_pay_${payload.receiptNo}`.substring(0, 48)
  );

  await logZaloPayment(
    db,
    payload,
    result.success ? 'sent' : 'failed',
    result.messageId || '',
    result.error || '',
    {
      payloadCaptured: true,
      templateId: cfg.znsPaymentTemplateId,
      payloadSnapshot: createZaloPayloadSnapshot({
        templateId: cfg.znsPaymentTemplateId,
        phone,
        templateData,
      }),
      providerErrorCode: result.errorCode,
    }
  );
}

async function logZaloPayment(
  db: DocumentStore,
  payload: ServerPaymentConfirmPayload,
  status: 'sent' | 'failed',
  zaloMessageId: string,
  errorMessage: string,
  evidence: {
    payloadCaptured: boolean;
    templateId?: string;
    payloadSnapshot?: ReturnType<typeof createZaloPayloadSnapshot>;
    providerErrorCode?: number;
  }
) {
  try {
    await db.collection('zalo_notifications').add({
      studentId: payload.studentId,
      studentName: payload.studentName,
      classId: payload.classId,
      className: payload.className,
      phone: evidence.payloadSnapshot?.phone || payload.phone,
      status,
      zaloMessageId,
      errorMessage,
      date: payload.receivedDate,
      type: 'payment',
      receiptNo: payload.receiptNo,
      amount: Number(payload.amount) || 0,
      payloadCaptured: evidence.payloadCaptured,
      ...(evidence.templateId ? { templateId: evidence.templateId } : {}),
      ...(evidence.payloadSnapshot ? { payloadSnapshot: evidence.payloadSnapshot } : {}),
      ...(evidence.providerErrorCode !== undefined
        ? { providerErrorCode: evidence.providerErrorCode }
        : {}),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[payOS] Failed to write Zalo notification log:', err);
  }
}

export async function sendNeedsReviewNotification(
  db: DocumentStore,
  payload: {
    paymentId: string;
    orderCode: number;
    amount: number;
    reason: string;
    studentName: string;
    className: string;
  }
): Promise<void> {
  try {
    await db.collection('admin_notifications').add({
      type: 'payment_needs_review',
      title: `Payment #${payload.orderCode} needs review`,
      message: `${payload.studentName} (${payload.className}): ${payload.amount.toLocaleString('vi-VN')}đ — ${payload.reason}`,
      paymentId: payload.paymentId,
      orderCode: payload.orderCode,
      amount: payload.amount,
      reason: payload.reason,
      read: false,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[payOS] Failed to write needs_review notification:', err);
  }
}

export { FieldValue, formatDateForZalo, normalizePhoneVN };
