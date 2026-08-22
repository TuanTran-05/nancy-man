import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { OnlinePaymentRequest } from '../../../types';
import type { Tab } from '../constants';
import { STATUS_COLORS, STATUS_LABELS } from '../constants';
import { fmt, formatDate } from '../financeUtils';
import { StudentProfileLink } from './StudentProfileLink';

interface PaymentsTabProps {
  activeTab: Tab;
  handleReconcilePayments: () => void;
  reconcilingPayments: boolean;
  loadPayments: (mode: 'reset' | 'append') => void;
  paymentsLoading: boolean;
  paymentHealth: {
    pendingOlderThan30m: number;
    needsReviewOpen: number;
    staleCreatingGatewaySession: number;
    failedWebhookEvents24h: number;
  };
  filteredPayments: OnlinePaymentRequest[];
  refreshingPaymentId: string | null;
  handleRefreshPaymentStatus: (p: OnlinePaymentRequest) => void;
  setResolveTarget: (p: OnlinePaymentRequest) => void;
  setResolveDecision: (v: 'approve' | 'reject') => void;
  setResolveReason: (v: string) => void;
  paymentsHasMore: boolean;
  language: string;
  t: any;
}

export const PaymentsTab: React.FC<PaymentsTabProps> = ({
  activeTab,
  handleReconcilePayments,
  reconcilingPayments,
  loadPayments,
  paymentsLoading,
  paymentHealth,
  filteredPayments,
  refreshingPaymentId,
  handleRefreshPaymentStatus,
  setResolveTarget,
  setResolveDecision,
  setResolveReason,
  paymentsHasMore,
  language,
  t,
}) => {
  if (activeTab !== 'payments') return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleReconcilePayments}
            disabled={reconcilingPayments}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {reconcilingPayments ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {t.financePage.reconcile}
          </button>
          <button
            onClick={() => loadPayments('reset')}
            disabled={paymentsLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {paymentsLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {t.financePage.refresh}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {paymentHealth.needsReviewOpen > 0 && (
            <span className="rounded-lg bg-orange-50 px-2.5 py-1 font-medium text-orange-700">
              {t.financePage.needsReviewBadge.replace(
                '{count}',
                String(paymentHealth.needsReviewOpen)
              )}
            </span>
          )}
          {paymentHealth.pendingOlderThan30m > 0 && (
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
              {t.financePage.pendingBadge.replace(
                '{count}',
                String(paymentHealth.pendingOlderThan30m)
              )}
            </span>
          )}
          {paymentHealth.staleCreatingGatewaySession > 0 && (
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              {t.financePage.staleBadge.replace(
                '{count}',
                String(paymentHealth.staleCreatingGatewaySession)
              )}
            </span>
          )}
          {paymentHealth.failedWebhookEvents24h > 0 && (
            <span className="rounded-lg bg-red-50 px-2.5 py-1 font-medium text-red-700">
              {t.financePage.webhookBadge.replace(
                '{count}',
                String(paymentHealth.failedWebhookEvents24h)
              )}
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.orderCode}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.student}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.className}
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">
                  {t.financePage.amount}
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">
                  {t.financePage.status}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.reason}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.created}
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">
                  {t.financePage.actions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    {t.financePage.noPayments}
                  </td>
                </tr>
              ) : (
                filteredPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{p.orderCode}</td>
                    <td className="px-4 py-3">
                      <StudentProfileLink studentId={p.studentId} name={p.studentName} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.className || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-medium">{fmt(p.amount)} đ</div>
                      {p.gatewayAmount !== undefined && p.gatewayAmount !== p.amount && (
                        <div className="text-[11px] text-orange-600">
                          {t.financePage.gateway}: {fmt(p.gatewayAmount)} đ
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(() => {
                        const effectiveStatus =
                          p.status === 'paid' && p.receiptStatus === 'void'
                            ? 'receipt_voided'
                            : p.status;
                        return (
                          <span
                            className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[effectiveStatus] || ''}`}
                          >
                            {STATUS_LABELS[effectiveStatus]?.[language] || effectiveStatus}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[260px]">
                      <div className="truncate">{p.reviewReason || '—'}</div>
                      {(p.gatewayReference || p.manualReceiptNo || p.accountingResolution) && (
                        <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                          {p.gatewayReference && (
                            <div className="truncate">
                              Ref: <span className="font-mono">{p.gatewayReference}</span>
                            </div>
                          )}
                          {p.manualReceiptNo && (
                            <div className="truncate">
                              {t.financePage.manualReceipt}: {p.manualReceiptNo}
                              {p.manualReceiptAmount !== undefined
                                ? ` (${fmt(p.manualReceiptAmount)} đ)`
                                : ''}
                            </div>
                          )}
                          {p.accountingResolution && (
                            <div className="truncate">{p.accountingResolution}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDate(p.createdAt, language)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {['creating_gateway_session', 'pending', 'needs_review'].includes(
                          p.status
                        ) && (
                          <button
                            onClick={() => handleRefreshPaymentStatus(p)}
                            disabled={refreshingPaymentId === p.id}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                            title={t.financePage.refreshPayOS}
                          >
                            {refreshingPaymentId === p.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                          </button>
                        )}
                        {p.status === 'needs_review' && (
                          <button
                            onClick={() => {
                              setResolveTarget(p);
                              setResolveDecision('approve');
                              setResolveReason('');
                            }}
                            className="px-2 py-1 text-xs text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                            title={t.financePage.resolve}
                          >
                            {t.financePage.resolve}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {paymentsHasMore && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => loadPayments('append')}
            disabled={paymentsLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {paymentsLoading && <Loader2 size={16} className="animate-spin" />}
            {t.financePage.loadMorePayments}
          </button>
        </div>
      )}
    </div>
  );
};
