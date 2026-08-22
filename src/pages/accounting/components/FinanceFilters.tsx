import React from 'react';
import { Search } from 'lucide-react';
import type { Class } from '../../../types';
import type { Tab } from '../constants';
import { formatClassNameWithTeacher } from '../../../lib/classes/sortClasses';
import { ApiDateTextInput } from '../../../components/forms/ApiDateTimeInputs';

interface FinanceFiltersProps {
  activeTab: Tab;
  classFilter: string;
  setClassFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  sortedClasses: Class[];
  teachers: { uid: string; displayName: string }[];
  referenceDataLoading: boolean;
  t: any;
}

export const FinanceFilters: React.FC<FinanceFiltersProps> = ({
  activeTab,
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
  t,
}) => {
  if (activeTab === 'report') return null;

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {activeTab !== 'expenses' && (
        <select
          data-testid="finance-class-filter"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          disabled={referenceDataLoading}
          className="px-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:cursor-wait disabled:opacity-60"
        >
          <option value="">{t.financePage.allClasses}</option>
          {sortedClasses
            .filter((c) => c.status !== 'archived')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {formatClassNameWithTeacher(c, teachers)}
              </option>
            ))}
        </select>
      )}

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="px-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      >
        <option value="all">{t.financePage.allStatuses}</option>
        {activeTab === 'ledgers' ? (
          <>
            <option value="unpaid">{t.financePage.statusUnpaid}</option>
            <option value="partial">{t.financePage.statusPartial}</option>
            <option value="paid">{t.financePage.statusPaid}</option>
            <option value="waived">{t.financePage.statusWaived}</option>
          </>
        ) : activeTab === 'payments' ? (
          <>
            <option value="creating_gateway_session">{t.financePage.statusCreating}</option>
            <option value="pending">{t.financePage.statusPending}</option>
            <option value="paid">{t.financePage.statusPaid}</option>
            <option value="needs_review">{t.financePage.statusNeedsReview}</option>
            <option value="expired">{t.financePage.statusExpired}</option>
            <option value="cancelled">{t.financePage.statusCancelled}</option>
            <option value="failed">{t.financePage.statusFailed}</option>
            <option value="manually_voided">{t.financePage.statusManuallyVoided}</option>
          </>
        ) : (
          <>
            <option value="draft">{t.financePage.statusDraft}</option>
            <option value="posted">{t.financePage.statusPosted}</option>
            <option value="void">{t.financePage.statusVoid}</option>
          </>
        )}
      </select>

      {(activeTab === 'receipts' || activeTab === 'expenses') && (
        <>
          <ApiDateTextInput
            label={t.financePage.fromDate}
            hideLabel
            value={dateFrom}
            onChange={setDateFrom}
            inputClassName="px-3 py-2 bg-white border-slate-100 rounded-xl text-sm focus:ring-blue-500"
            placeholder={t.financePage.fromDate}
          />
          <ApiDateTextInput
            label={t.financePage.toDate}
            hideLabel
            value={dateTo}
            onChange={setDateTo}
            inputClassName="px-3 py-2 bg-white border-slate-100 rounded-xl text-sm focus:ring-blue-500"
            placeholder={t.financePage.toDate}
          />
        </>
      )}

      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.financePage.searchPlaceholder}
          className="w-full pl-9 pr-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>
    </div>
  );
};
