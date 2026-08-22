export type Tab =
  | 'students'
  | 'student-finance'
  | 'ledgers'
  | 'class-reconciliation'
  | 'payments'
  | 'receipts'
  | 'expenses'
  | 'wallet'
  | 'report';

export const FINANCE_PAGE_LIMIT = 2000;
export const RECENT_FINANCE_DOC_LIMIT = 50;
export const PAYMENT_PAGE_SIZE = 50;

export const STATUS_COLORS: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  waived: 'bg-slate-100 text-slate-600',
  draft: 'bg-slate-100 text-slate-600',
  posted: 'bg-emerald-100 text-emerald-700',
  void: 'bg-red-100 text-red-700',
  creating_gateway_session: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-slate-100 text-slate-600',
  expired: 'bg-slate-100 text-slate-600',
  failed: 'bg-red-100 text-red-700',
  create_failed: 'bg-red-100 text-red-700',
  needs_review: 'bg-orange-100 text-orange-700',
  receipt_voided: 'bg-red-100 text-red-700',
  manually_voided: 'bg-red-100 text-red-700',
};

export const STATUS_LABELS: Record<string, { vi: string; en: string }> = {
  unpaid: { vi: 'Chưa đóng', en: 'Unpaid' },
  partial: { vi: 'Đóng 1 phần', en: 'Partial' },
  paid: { vi: 'Đã đóng đủ', en: 'Paid' },
  waived: { vi: 'Miễn giảm', en: 'Waived' },
  draft: { vi: 'Nháp', en: 'Draft' },
  posted: { vi: 'Đã chốt', en: 'Posted' },
  void: { vi: 'Đã hủy', en: 'Void' },
  creating_gateway_session: { vi: 'Đang tạo link', en: 'Creating' },
  pending: { vi: 'Chờ thanh toán', en: 'Pending' },
  cancelled: { vi: 'Đã hủy', en: 'Cancelled' },
  expired: { vi: 'Hết hạn', en: 'Expired' },
  failed: { vi: 'Thất bại', en: 'Failed' },
  create_failed: { vi: 'Tạo link lỗi', en: 'Create failed' },
  needs_review: { vi: 'Cần kiểm tra', en: 'Needs review' },
  receipt_voided: { vi: 'Phiếu thu đã hủy', en: 'Receipt voided' },
  manually_voided: { vi: 'Đã hủy thủ công', en: 'Manually voided' },
};
