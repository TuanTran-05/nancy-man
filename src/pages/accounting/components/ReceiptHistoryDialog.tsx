import { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Class } from '../../../types';
import { ModalPortal } from '../../../components/common/ModalPortal';
import { FinanceFilters } from './FinanceFilters';
import { ReceiptHistoryTable } from './ReceiptHistoryTable';
import type { ReceiptHistoryTableProps } from './ReceiptHistoryTable';

export type ReceiptHistoryDialogProps = ReceiptHistoryTableProps & {
  onClose: () => void;
  classFilter: string;
  setClassFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  dateFrom: string;
  setDateFrom: (value: string) => void;
  dateTo: string;
  setDateTo: (value: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  sortedClasses: Class[];
  teachers: Array<{ uid: string; displayName: string }>;
  referenceDataLoading: boolean;
  referenceDataError: string | null;
  onRetryReferenceData: () => void;
  historyError: string | null;
  onRetryHistory: () => void;
};

export function ReceiptHistoryDialog({
  onClose,
  classFilter,
  setClassFilter,
  statusFilter,
  setStatusFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  searchQuery,
  setSearchQuery,
  sortedClasses,
  teachers,
  referenceDataLoading,
  referenceDataError,
  onRetryReferenceData,
  historyError,
  onRetryHistory,
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
}: ReceiptHistoryDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1) return;
      onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const canRenderTable = !referenceDataLoading && !referenceDataError && !historyError;

  return (
    <ModalPortal trapFocus lockScroll>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lịch sử thu"
          className="relative z-10 flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-4 sm:px-6">
            <h2 className="text-xl font-bold text-slate-800">Lịch sử thu</h2>
            <button
              type="button"
              aria-label="Đóng"
              onClick={onClose}
              className="rounded-full p-2 transition-colors hover:bg-slate-100"
            >
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
            <FinanceFilters
              activeTab="receipts"
              classFilter={classFilter}
              setClassFilter={setClassFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              dateFrom={dateFrom}
              setDateFrom={setDateFrom}
              dateTo={dateTo}
              setDateTo={setDateTo}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              sortedClasses={sortedClasses}
              teachers={teachers}
              referenceDataLoading={referenceDataLoading}
              t={t}
            />

            {referenceDataLoading && (
              <div className="flex justify-center py-12" aria-label="Đang tải dữ liệu tham chiếu">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            )}

            {!referenceDataLoading && referenceDataError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
              >
                <p>{referenceDataError}</p>
                <button
                  type="button"
                  onClick={onRetryReferenceData}
                  className="mt-3 rounded-lg bg-white px-3 py-1.5 text-sm font-medium shadow-sm"
                >
                  Thử lại
                </button>
              </div>
            )}

            {!referenceDataLoading && !referenceDataError && historyError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
              >
                <p>{historyError}</p>
                <button
                  type="button"
                  onClick={onRetryHistory}
                  className="mt-3 rounded-lg bg-white px-3 py-1.5 text-sm font-medium shadow-sm"
                >
                  Tải lại lịch sử
                </button>
              </div>
            )}

            {canRenderTable && loading && receipts.length === 0 && (
              <div
                className="rounded-xl border border-slate-100 bg-white px-4 py-8 text-center text-sm text-slate-500"
                aria-label="Đang tải lịch sử thu"
              >
                <Loader2
                  className="mx-auto mb-2 h-5 w-5 animate-spin text-blue-500"
                  aria-hidden="true"
                />
                <p>Đang tải lịch sử thu...</p>
              </div>
            )}

            {canRenderTable && (!loading || receipts.length > 0) && (
              <ReceiptHistoryTable
                receipts={receipts}
                studentMap={studentMap}
                classMap={classMap}
                actionLoading={actionLoading}
                onPostReceipt={onPostReceipt}
                onVoidReceipt={onVoidReceipt}
                hasMore={hasMore}
                loading={loading}
                onLoadMore={onLoadMore}
                language={language}
                t={t}
              />
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Đóng lịch sử thu"
          className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
          onClick={onClose}
        />
      </div>
    </ModalPortal>
  );
}
