import type { OnlinePaymentRequest } from '../../types';

export type FinanceTab = 'ledgers' | 'payments' | 'receipts' | 'expenses' | 'report';
export type FinanceLanguage = 'vi' | 'en';

export function defaultStatusFilterForFinanceTab(tab: FinanceTab): string {
  return tab === 'payments' ? 'needs_review' : 'all';
}

export function getPaymentReviewDetailLines(
  payment: OnlinePaymentRequest,
  language: FinanceLanguage,
  formatAmount: (amount: number) => string
): string[] {
  const lines: string[] = [];
  if (typeof payment.gatewayAmount === 'number') {
    lines.push(
      `${language === 'vi' ? 'Số tiền cổng' : 'Gateway amount'}: ${formatAmount(payment.gatewayAmount)}`
    );
  }
  if (payment.gatewayReference) {
    lines.push(
      `${language === 'vi' ? 'Mã tham chiếu cổng' : 'Gateway ref'}: ${payment.gatewayReference}`
    );
  }
  if (payment.manualReceiptNo) {
    lines.push(
      `${language === 'vi' ? 'Phiếu thu thủ công' : 'Manual receipt'}: ${payment.manualReceiptNo}`
    );
  }
  if (typeof payment.manualReceiptAmount === 'number') {
    lines.push(
      `${language === 'vi' ? 'Số tiền thủ công' : 'Manual amount'}: ${formatAmount(payment.manualReceiptAmount)}`
    );
  }
  return lines;
}
