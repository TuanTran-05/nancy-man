import React from 'react';
import { Loader2 } from 'lucide-react';
import type { OnlinePaymentRequest } from '../../../types';
import { fmt } from '../financeUtils';

interface ResolveReviewModalProps {
  resolveTarget: OnlinePaymentRequest | null;
  setResolveTarget: (v: OnlinePaymentRequest | null) => void;
  resolveDecision: 'approve' | 'reject';
  setResolveDecision: (v: 'approve' | 'reject') => void;
  resolveReason: string;
  setResolveReason: (v: string) => void;
  resolveLoading: boolean;
  handleResolveReview: () => void;
  t: any;
}

export const ResolveReviewModal: React.FC<ResolveReviewModalProps> = ({
  resolveTarget,
  setResolveTarget,
  resolveDecision,
  setResolveDecision,
  resolveReason,
  setResolveReason,
  resolveLoading,
  handleResolveReview,
  t,
}) => {
  if (!resolveTarget) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-4">{t.financePage.resolveReview}</h3>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-slate-500">
                {t.financePage.student}:{' '}
                <span className="font-medium text-slate-700">{resolveTarget.studentName}</span>
              </p>
              <p className="text-sm text-slate-500">
                {t.financePage.orderCode}:{' '}
                <span className="font-mono">{resolveTarget.orderCode}</span>
              </p>
              <p className="text-sm text-slate-500">
                {t.financePage.amount}:{' '}
                <span className="font-medium">{fmt(resolveTarget.amount)} đ</span>
              </p>
              {resolveTarget.reviewReason && (
                <p className="text-sm text-orange-600 mt-1">
                  {t.financePage.reviewReason}: {resolveTarget.reviewReason}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t.financePage.decision}</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setResolveDecision('approve')}
                  className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    resolveDecision === 'approve'
                      ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-300'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t.financePage.approve}
                </button>
                <button
                  onClick={() => setResolveDecision('reject')}
                  className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    resolveDecision === 'reject'
                      ? 'bg-red-100 text-red-700 border-2 border-red-300'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t.financePage.reject}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t.financePage.reason}</label>
              <textarea
                value={resolveReason}
                onChange={(e) => setResolveReason(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                placeholder={t.financePage.reasonPlaceholder}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={() => {
                setResolveTarget(null);
                setResolveReason('');
              }}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {t.financePage.cancel}
            </button>
            <button
              onClick={handleResolveReview}
              disabled={resolveLoading}
              className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                resolveDecision === 'approve'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-red-600 text-white hover:bg-red-700'
              }`}
            >
              {resolveLoading ? (
                <Loader2 size={16} className="animate-spin mx-auto" />
              ) : resolveDecision === 'approve' ? (
                t.financePage.approve
              ) : (
                t.financePage.reject
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
