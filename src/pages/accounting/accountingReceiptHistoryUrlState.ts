const RECEIPT_HISTORY_VIEW = 'receipt-history';

function parseParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

export function isReceiptHistoryRequested(search: string): boolean {
  const params = parseParams(search);
  return params.get('view') === RECEIPT_HISTORY_VIEW || params.get('tab') === 'receipts';
}

export function setReceiptHistoryView(search: string, open: boolean): string {
  const params = parseParams(search);
  params.set('tab', 'students');
  if (open) params.set('view', RECEIPT_HISTORY_VIEW);
  else params.delete('view');
  const result = params.toString();
  return result ? `?${result}` : '';
}
