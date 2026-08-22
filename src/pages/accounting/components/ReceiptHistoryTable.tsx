import React, { useState } from 'react';
import { CheckCircle, ChevronDown, ChevronUp, Loader2, XCircle } from 'lucide-react';
import type { Class, Receipt, ReceiptAllocation, Student } from '../../../types';
import { STATUS_COLORS, STATUS_LABELS } from '../constants';
import { fmt, formatDate } from '../financeUtils';
import { StudentProfileLink } from './StudentProfileLink';

export interface ReceiptHistoryTableProps {
  receipts: Receipt[];
  studentMap: Record<string, Student>;
  classMap: Record<string, Class>;
  actionLoading: string | null;
  onPostReceipt: (id: string) => void;
  onVoidReceipt: (id: string) => void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  language: string;
  t: any;
}

function allocationClassLabel(receipt: Receipt, classMap: Record<string, Class>): string {
  const allocations = receipt.allocations || [];
  if (allocations.length > 1) return `${allocations.length} khoản công nợ`;
  if (allocations.length === 1) {
    return classMap[allocations[0].classId]?.name || allocations[0].classId;
  }
  return classMap[receipt.classId]?.name || '—';
}

function allocationDiscount(allocation: ReceiptAllocation): number {
  return Number(allocation.discountAmount || 0) + Number(allocation.siblingDiscountAmount || 0);
}

export const ReceiptHistoryTable: React.FC<ReceiptHistoryTableProps> = ({
  receipts,
  studentMap,
  classMap,
  actionLoading,
  onPostReceipt,
  onVoidReceipt,
  hasMore,
  loading,
  onLoadMore,
  language,
  t,
}) => {
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Set<string>>(new Set());

  function toggleDetails(receiptId: string) {
    setExpandedReceiptIds((current) => {
      const next = new Set(current);
      if (next.has(receiptId)) next.delete(receiptId);
      else next.add(receiptId);
      return next;
    });
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t.financePage.receiptNo}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t.financePage.student}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t.financePage.className}
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-600">
                  {t.financePage.amount}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t.financePage.discount}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t.financePage.method}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t.financePage.receiptDate}
                </th>
                <th className="px-4 py-3 text-center font-medium text-slate-600">
                  {t.financePage.status}
                </th>
                <th className="px-4 py-3 text-center font-medium text-slate-600">
                  {t.financePage.actions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    {t.financePage.noReceipts}
                  </td>
                </tr>
              ) : (
                receipts.map((receipt) => {
                  const student = studentMap[receipt.studentId];
                  const allocations = receipt.allocations || [];
                  const expanded = expandedReceiptIds.has(receipt.id);
                  const methodLabels: Record<string, string> = {
                    cash: t.financePage.methodCash,
                    transfer: t.financePage.methodTransfer,
                    other: t.financePage.methodOther,
                  };
                  const allocationDiscountTotal = allocations.reduce(
                    (sum, allocation) => sum + allocationDiscount(allocation),
                    0
                  );

                  return (
                    <React.Fragment key={receipt.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs">{receipt.receiptNo}</td>
                        <td className="px-4 py-3">
                          <StudentProfileLink studentId={receipt.studentId} name={student?.name} />
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div className="flex items-center gap-1">
                            <span>{allocationClassLabel(receipt, classMap)}</span>
                            {allocations.length > 0 && (
                              <button
                                type="button"
                                aria-label={
                                  expanded ? 'Ẩn chi tiết phân bổ' : 'Xem chi tiết phân bổ'
                                }
                                aria-expanded={expanded}
                                onClick={() => toggleDetails(receipt.id)}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              >
                                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {fmt(receipt.amountReceived)} đ
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {allocations.length > 0
                            ? allocationDiscountTotal > 0
                              ? `-${fmt(allocationDiscountTotal)} đ`
                              : '—'
                            : receipt.discountType === 'full_waiver'
                              ? t.financePage.waived100
                              : receipt.discountType === 'hardship'
                                ? t.financePage.hardship20
                                : receipt.discountType === 'custom'
                                  ? receipt.discountAmount
                                    ? `-${fmt(receipt.discountAmount)}`
                                    : receipt.discountPercent
                                      ? `-${receipt.discountPercent}%`
                                      : t.financePage.custom
                                  : receipt.discountPercent
                                    ? `-${receipt.discountPercent}%`
                                    : '—'}
                          {receipt.discountReason && (
                            <span className="mt-0.5 block text-xs italic text-slate-400">
                              {receipt.discountReason}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {methodLabels[receipt.paymentMethod] || receipt.paymentMethod}
                        </td>
                        <td className="px-4 py-3">{formatDate(receipt.receivedDate, language)}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[receipt.status] || ''}`}
                          >
                            {STATUS_LABELS[receipt.status]?.[language] || receipt.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {receipt.status === 'draft' && (
                              <button
                                onClick={() => onPostReceipt(receipt.id)}
                                disabled={actionLoading === receipt.id}
                                className="rounded-lg p-1.5 text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50"
                                title={t.financePage.post}
                              >
                                {actionLoading === receipt.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <CheckCircle size={14} />
                                )}
                              </button>
                            )}
                            {receipt.status === 'posted' && receipt.walletDeposit ? (
                              <span
                                className="text-xs italic text-slate-400"
                                title={t.financePage.voidAction}
                              >
                                {t.financePage.walletReceiptVoidHint}
                              </span>
                            ) : (
                              receipt.status === 'posted' && (
                                <button
                                  onClick={() => onVoidReceipt(receipt.id)}
                                  disabled={actionLoading === receipt.id}
                                  className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                                  title={t.financePage.voidAction}
                                >
                                  {actionLoading === receipt.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <XCircle size={14} />
                                  )}
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && allocations.length > 0 && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={9} className="px-6 py-3">
                            <div className="grid gap-2 md:grid-cols-2">
                              {allocations.map((allocation, index) => (
                                <div
                                  key={`${allocation.ledgerId}-${index}`}
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                                >
                                  <div className="flex justify-between gap-3">
                                    <span className="font-medium text-slate-800">
                                      {classMap[allocation.classId]?.name ||
                                        allocation.classId ||
                                        allocation.ledgerId}
                                    </span>
                                    <span>{fmt(allocation.amount)} đ</span>
                                  </div>
                                  {allocationDiscount(allocation) > 0 && (
                                    <div className="mt-1 text-emerald-700">
                                      Giảm: {fmt(allocationDiscount(allocation))} đ
                                    </div>
                                  )}
                                  {allocation.discountReason && (
                                    <div className="mt-1 italic text-slate-400">
                                      {allocation.discountReason}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {language === 'vi' ? 'Tải thêm phiếu thu' : 'Load more receipts'}
          </button>
        </div>
      )}
    </>
  );
};
