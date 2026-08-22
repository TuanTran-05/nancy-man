export interface TuitionRecord {
  id: string;
  studentId: string;
  classId: string;
  teacherId: string;
  month: string; // "2026-04" (YYYY-MM)
  amount: number; // amount to pay
  paid: number; // amount paid
  status: 'unpaid' | 'partial' | 'paid' | 'waived';
  dueDate: string;
  paidAt?: string;
  paidBy?: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TuitionConfig {
  id: string;
  classId: string;
  defaultAmount: number;
  currency: 'VND' | 'USD';
  dueDayOfMonth: number; // Ví dụ: 10 (ngày 10 hàng tháng)
  autoGenerateMonthly: boolean;
  teacherId: string;
  createdAt: string;
}

export type LedgerStatus = 'unpaid' | 'partial' | 'paid' | 'waived';
export type ReceiptStatus = 'draft' | 'posted' | 'void';
export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'void' | 'superseded';
export type ExpenseStatus = 'draft' | 'posted' | 'void';
export type PaymentMethod = 'cash' | 'transfer' | 'other';
export type OnlinePaymentStatus =
  | 'creating_gateway_session'
  | 'pending'
  | 'paid'
  | 'cancelled'
  | 'expired'
  | 'stale'
  | 'failed'
  | 'create_failed'
  | 'needs_review'
  | 'manually_voided';
export type DiscountType =
  | 'none'
  | 'first_prize'
  | 'second_prize'
  | 'full_waiver'
  | 'hardship'
  | 'custom';

export interface CourseFeeLedger {
  id: string;
  studentId: string;
  classId: string;
  amount: number; // total fee for the course
  paidTotal: number;
  discountTotal?: number;
  /** Sibling scholarship already granted against this ledger, in dong. */
  siblingDiscountTotal?: number;
  status: LedgerStatus;
  termStart?: string;
  termEnd?: string;
  source?: 'course' | 'legacy_tuition';
  periodType?: 'course' | 'monthly';
  month?: string;
  legacyTuitionRecordId?: string;
  migrationRunId?: string;
  createdAt: string;
  updatedAt?: string;
  note?: string;
  dueDate?: string;
  tuitionReminderCount?: number;
  tuitionReminderLastSentAt?: string;
  tuitionReminderLastSentBy?: string;
  tuitionReminderLastSentByName?: string;
  tuitionReminderLastAmount?: number;
  tuitionReminderLastDueDate?: string;
  tuitionNoticeCount?: number;
  tuitionNoticeLastSentAt?: string;
  tuitionNoticeLastSentBy?: string;
  tuitionNoticeLastSentByName?: string;
  tuitionNoticeLastSource?: 'evaluation' | 'accounting' | 'office';
  tuitionNoticeLastMessageId?: string;
  tuitionNoticeLastAmount?: number;
  tuitionNoticeLastDueDate?: string;
}

export type ReceiptAllocation = {
  ledgerId: string;
  classId: string;
  amount: number;
  discountType?: DiscountType;
  discountAmount?: number;
  discountPercent?: number;
  discountReason?: string;
  siblingDiscount?: boolean;
  siblingDiscountAmount?: number;
  siblingDiscountWaived?: boolean;
  siblingDiscountWaivedReason?: string;
};

export interface Receipt {
  id: string;
  receiptNo: string; // PT-YYMMDD-NNN
  type: 'tuition';
  /** True for wallet top-up receipts, which have no ledgerId. */
  walletDeposit?: boolean;
  flowVersion?: 'wallet-manual-v2';
  transactionGroupId?: string;
  studentId: string;
  classId: string;
  classIds?: string[];
  ledgerId?: string;
  invoiceId?: string;
  invoiceNo?: string;
  amountReceived: number;
  allocations?: ReceiptAllocation[];
  walletBalanceBefore?: number;
  walletBalanceAfter?: number;
  paymentMethod: PaymentMethod;
  receivedDate: string;
  createdBy: string;
  createdByRole: string;
  status: ReceiptStatus;
  createdAt: string;
  updatedAt?: string;
  note?: string;
  discountType?: DiscountType;
  siblingDiscount?: boolean;
  /** The sibling portion of `discountAmount`, in dong. */
  siblingDiscountAmount?: number;
  siblingDiscountWaived?: boolean;
  siblingDiscountWaivedReason?: string;
  discountPercent?: number;
  discountAmount?: number;
  originalAmount?: number;
  discountReason?: string;
  paymentRequestId?: string;
  source?: 'manual' | 'payos' | 'migration';
  payosOrderCode?: number;
  payosPaymentLinkId?: string;
  payosReference?: string;
  createdByName?: string;
  paymentConfirmationSource?: 'webhook' | 'gateway_status' | 'gateway_reconcile';
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
}

export type WalletTransactionType = 'deposit' | 'allocation' | 'credit' | 'refund' | 'adjustment';
export type WalletTransactionStatus = 'proposed' | 'posted' | 'rejected' | 'void';

export interface WalletTransaction {
  id: string;
  schemaVersion?: 2;
  transactionGroupId?: string;
  groupSequence?: number;
  source?: 'manual_receipt' | 'manual_allocation' | 'student_refund';
  studentId: string;
  type: WalletTransactionType;
  amount: number; // always positive; direction comes from type
  direction?: 'in' | 'out'; // adjustment only
  status: WalletTransactionStatus;
  receiptId?: string;
  receiptNo?: string;
  ledgerId?: string;
  expenseId?: string;
  expenseNo?: string;
  classId?: string;
  note?: string;
  reason?: string;
  createdBy: string;
  createdByName?: string;
  approvedBy?: string;
  approvedByName?: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
  createdAt: string;
  postedAt?: string;
  updatedAt?: string;
}

export type WalletStudentContext = {
  studentId: string;
  walletBalance: number;
  /** `className` is resolved server-side so closed classes still have a label. */
  ledgers: Array<CourseFeeLedger & { className?: string }>;
};

export type WalletHistoryResponse = {
  walletBalance: number;
  opening?: { startedAt: string; balance: number } | null;
  transactions: Array<
    WalletTransaction & { signedAmount: number; balanceAfter: number; className?: string }
  >;
};

export interface Invoice {
  id: string;
  invoiceNo: string;
  ledgerId: string;
  studentId: string;
  classId: string;
  parentUid?: string;
  currency: 'VND';
  status: InvoiceStatus;
  amountDue: number;
  amountPaid?: number;
  ledgerAmountSnapshot: number;
  paidTotalSnapshot: number;
  discountTotalSnapshot: number;
  studentSnapshot: { id: string; name: string };
  classSnapshot: { id: string; name: string };
  lineItems: Array<{ type: 'tuition'; ledgerId: string; description: string; amount: number }>;
  issuedAt: string;
  createdAt: string;
  updatedAt?: string;
  paidAt?: string;
  supersededAt?: string;
  supersededByInvoiceId?: string;
  snapshotVersion: number;
}

export interface OnlinePaymentRequest {
  id: string;
  orderCode: number;
  ledgerId: string;
  studentId: string;
  classId: string;
  parentUid: string;
  studentName?: string;
  className?: string;
  invoiceId?: string;
  invoiceNo?: string;
  invoiceAmountSnapshot?: number;
  invoiceSnapshotVersion?: number;
  amount: number;
  currency: 'VND';
  provider: 'payos';
  status: OnlinePaymentStatus;
  gatewayStatus?: string;
  paymentLinkId?: string;
  checkoutUrl?: string;
  receiptId?: string;
  receiptStatus?: string | null;
  reviewReason?: string;
  reviewResolution?: 'approved' | 'rejected' | 'manual_handling_required';
  accountingResolution?:
    | 'receipt_voided_manual_handling'
    | 'manual_receipt_posted_while_gateway_session_active';
  gatewayAmount?: number;
  gatewayReference?: string;
  manualReceiptId?: string;
  manualReceiptNo?: string;
  manualReceiptAmount?: number;
  manualReceiptPostedBy?: string;
  manualReceiptPostedAt?: string;
  failureReason?: string;
  expiresAt?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt?: string;
  reconciliationCheckedAt?: string;
  returnUrl?: string;
  cancelUrl?: string;
  description?: string;
  qrCode?: string;
  staleReason?: string;
  gatewaySnapshot?: Record<string, unknown>;
  reconciliationError?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
}

export interface PaymentWebhookEvent {
  id: string;
  provider: 'payos';
  eventHash: string;
  signatureValid: boolean;
  envelopeCode?: string;
  envelopeDesc?: string;
  envelopeSuccess?: boolean;
  orderCode?: number;
  amount?: number;
  paymentLinkId?: string;
  providerReference?: string;
  processingStatus: string;
  error?: string;
  receivedAt: string;
  processedAt?: string;
  rawPayload?: Record<string, unknown>;
  transactionDateTime?: string;
  providerCode?: string;
  updatedAt?: string;
  processingMessage?: string;
  paymentRequestId?: string;
  receiptId?: string;
}

export interface AdminNotification {
  id: string;
  type: 'payment_needs_review' | 'payment_failed' | 'system_alert';
  title: string;
  message: string;
  paymentId?: string;
  orderCode?: number;
  amount?: number;
  reason?: string;
  read: boolean;
  createdAt: string;
}

export interface Expense {
  id: string;
  expenseNo: string;
  type?: 'activity' | 'wallet_refund';
  studentId?: string;
  walletTransactionId?: string;
  reason?: string;
  category: string;
  amount: number;
  paidDate: string;
  payee: string;
  note?: string;
  classId?: string;
  purpose?: string;
  createdBy: string;
  status: ExpenseStatus;
  createdAt: string;
  updatedAt?: string;
}
