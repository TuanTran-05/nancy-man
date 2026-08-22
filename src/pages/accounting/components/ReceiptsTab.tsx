import React from 'react';
import { Plus } from 'lucide-react';
import type { Class, Receipt, Student } from '../../../types';
import type { Tab } from '../constants';
import { ReceiptHistoryTable } from './ReceiptHistoryTable';

interface ReceiptsTabProps {
  activeTab: Tab;
  setShowReceiptModal: (value: boolean) => void;
  filteredReceipts: Receipt[];
  studentMap: Record<string, Student>;
  classMap: Record<string, Class>;
  actionLoading: string | null;
  handlePostReceipt: (id: string) => void;
  handleVoidReceipt: (id: string) => void;
  receiptsHasMore: boolean;
  receiptsLoading: boolean;
  loadReceipts: (mode: 'append') => void;
  language: string;
  t: any;
}

export const ReceiptsTab: React.FC<ReceiptsTabProps> = ({
  activeTab,
  setShowReceiptModal,
  filteredReceipts,
  studentMap,
  classMap,
  actionLoading,
  handlePostReceipt,
  handleVoidReceipt,
  receiptsHasMore,
  receiptsLoading,
  loadReceipts,
  language,
  t,
}) => {
  if (activeTab !== 'receipts') return null;

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowReceiptModal(true)}
        className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        <Plus size={16} />
        {t.financePage.createReceipt}
      </button>

      <ReceiptHistoryTable
        receipts={filteredReceipts}
        studentMap={studentMap}
        classMap={classMap}
        actionLoading={actionLoading}
        onPostReceipt={handlePostReceipt}
        onVoidReceipt={handleVoidReceipt}
        hasMore={receiptsHasMore}
        loading={receiptsLoading}
        onLoadMore={() => loadReceipts('append')}
        language={language}
        t={t}
      />
    </div>
  );
};
