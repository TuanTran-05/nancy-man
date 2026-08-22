import { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Class } from '../../../types';
import type { WalletHistoryResponse } from '../../../types/finance';
import { ModalPortal } from '../../../components/common/ModalPortal';
import { fmt } from '../financeUtils';
import { WalletHistoryPanel } from './WalletHistoryPanel';

export type WalletHistoryModalStudent = {
  id: string;
  name: string;
  code: string;
  walletBalance: number;
};

export type WalletHistoryModalProps = {
  student: WalletHistoryModalStudent;
  history: WalletHistoryResponse | null;
  loading: boolean;
  classes: Class[];
  language: string;
  t: any;
  onClose: () => void;
  onVoidAllocationGroup: (
    memberId: string,
    input: { reason: string; idempotencyKey: string }
  ) => Promise<void>;
};

export function WalletHistoryModal({
  student,
  history,
  loading,
  classes,
  language,
  t,
  onClose,
  onVoidAllocationGroup,
}: WalletHistoryModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // A nested dialog (voiding an allocation) owns Escape while it is open.
      const openDialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (openDialogs.length > 1) return;
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <ModalPortal trapFocus lockScroll>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lịch sử ví"
          className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-5 py-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Lịch sử ví</h2>
              <p className="mt-1 text-sm text-slate-500">
                <span className="font-medium text-slate-700">{student.name}</span>
                {student.code ? ` · ${student.code}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-xs text-slate-500">Số dư hiện tại</p>
                <p className="font-semibold text-emerald-700">{fmt(student.walletBalance)} đ</p>
              </div>
              <button
                type="button"
                aria-label="Đóng"
                onClick={onClose}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading || !history ? (
              <div className="flex justify-center py-12">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <WalletHistoryPanel
                history={history}
                classes={classes}
                language={language}
                t={t}
                onVoidAllocationGroup={onVoidAllocationGroup}
              />
            )}
          </div>
        </div>
        {/* Sits behind the dialog via z-index, and last in the DOM so the focus
            trap starts on the close button instead of the backdrop. */}
        <button
          type="button"
          aria-label="Đóng lịch sử ví"
          className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
          onClick={onClose}
        />
      </div>
    </ModalPortal>
  );
}
