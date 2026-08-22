import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Tab } from '../constants';
import type { FinanceDetailType, FinanceReport } from '../../../lib/api/financeApi';
import { fmt } from '../financeUtils';
import { ApiDateTextInput } from '../../../components/forms/ApiDateTimeInputs';
import { translations } from '../../../lib/i18n/translations';
import { FinanceTransactionDetailsModal } from '../../admin/components/financeReport/FinanceTransactionDetailsModal';
import type { FinanceDetailsText } from '../../admin/components/financeReport/types';
import { DailyFinanceBreakdownTable } from './DailyFinanceBreakdownTable';
import {
  getReportDatePresets,
  type ReportDatePresetKey,
  type ReportDateRange,
} from '../reportDatePresets';

export type ReportLoadOptions = {
  forceLive?: boolean;
  range?: ReportDateRange;
};

interface ReportTabProps {
  activeTab: Tab;
  reportFrom: string;
  setReportFrom: (v: string) => void;
  reportTo: string;
  setReportTo: (v: string) => void;
  handleLoadReport: (options?: ReportLoadOptions) => void | Promise<void>;
  reportLoading: boolean;
  report: FinanceReport | null;
  reportRange: { from: string; to: string } | null;
  language: string;
  t: { financePage: Record<string, string> };
}

export const ReportTab: React.FC<ReportTabProps> = (props) => {
  if (props.activeTab !== 'report') return null;
  return <ReportTabContent {...props} />;
};

type DetailSelection = {
  type: FinanceDetailType;
  startDate: string;
  endDate: string;
  expectedTotal: number;
};

const ReportTabContent: React.FC<ReportTabProps> = ({
  reportFrom,
  setReportFrom,
  reportTo,
  setReportTo,
  handleLoadReport,
  reportLoading,
  report,
  reportRange,
  language,
  t,
}) => {
  const [breakdownMode, setBreakdownMode] = useState<'day' | 'month'>('day');
  const [detailSelection, setDetailSelection] = useState<DetailSelection | null>(null);
  const [presetReferenceDate, setPresetReferenceDate] = useState(() => new Date());
  const reportMatchesFilters = reportRange?.from === reportFrom && reportRange?.to === reportTo;
  useEffect(() => {
    setDetailSelection(null);
  }, [reportFrom, reportTo, reportRange?.from, reportRange?.to]);
  const detailText = translations[language === 'vi' ? 'vi' : 'en']
    .adminFinanceReport as FinanceDetailsText;
  const presetRanges = getReportDatePresets(presetReferenceDate);
  const quickPresets: Array<{
    key: ReportDatePresetKey;
    label: string;
    from: string;
    to: string;
  }> = [
    { key: 'today', label: t.financePage.today, ...presetRanges.today },
    { key: 'thisMonth', label: t.financePage.thisMonth, ...presetRanges.thisMonth },
    { key: 'lastMonth', label: t.financePage.lastMonth, ...presetRanges.lastMonth },
    { key: 'thisQuarter', label: t.financePage.thisQuarter, ...presetRanges.thisQuarter },
    { key: 'thisYear', label: t.financePage.thisYear, ...presetRanges.thisYear },
    { key: 'lastYear', label: t.financePage.lastYear, ...presetRanges.lastYear },
  ];
  useEffect(() => {
    const current = new Date();
    const referenceIsCurrentDay =
      presetReferenceDate.getFullYear() === current.getFullYear() &&
      presetReferenceDate.getMonth() === current.getMonth() &&
      presetReferenceDate.getDate() === current.getDate();
    if (!referenceIsCurrentDay) {
      setPresetReferenceDate(current);
      return;
    }

    const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    const timeoutId = window.setTimeout(
      () => setPresetReferenceDate(new Date()),
      nextMidnight.getTime() - current.getTime()
    );

    return () => window.clearTimeout(timeoutId);
  }, [presetReferenceDate]);
  const handleLoadReportRef = useRef(handleLoadReport);
  useEffect(() => {
    handleLoadReportRef.current = handleLoadReport;
  }, [handleLoadReport]);
  const handleSummaryStale = useCallback(() => {
    void handleLoadReportRef.current({ forceLive: true });
  }, []);

  const openDetails = (
    type: FinanceDetailType,
    startDate: string,
    endDate: string,
    expectedTotal: number
  ) => {
    if (!reportMatchesFilters) return;
    setDetailSelection({ type, startDate, endDate, expectedTotal });
  };
  const fundComposition = [
    { name: t.financePage.income, value: report?.totalIncome || 0, color: '#059669' },
    { name: t.financePage.expenses, value: report?.totalExpenses || 0, color: '#dc2626' },
    {
      name: t.financePage.scholarships,
      value: report?.totalScholarships || 0,
      color: '#d97706',
    },
  ];
  const fundCompositionTotal = fundComposition.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-4">
      {/* Quick filter buttons */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600">{t.financePage.reportPeriod}</p>
        <div role="group" aria-label={t.financePage.reportPeriod} className="flex flex-wrap gap-2">
          {quickPresets.map((preset) => {
            const isApplied =
              reportMatchesFilters && reportFrom === preset.from && reportTo === preset.to;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={isApplied}
                disabled={reportLoading}
                onClick={() => {
                  const activationDate = new Date();
                  const range = getReportDatePresets(activationDate)[preset.key];
                  setPresetReferenceDate(activationDate);
                  setReportFrom(range.from);
                  setReportTo(range.to);
                  void handleLoadReport({ range });
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isApplied
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-white border border-slate-100 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t.financePage.fromDate}</label>
          <ApiDateTextInput
            label={t.financePage.fromDate}
            hideLabel
            value={reportFrom}
            onChange={setReportFrom}
            inputClassName="px-3 py-2 bg-white border-slate-100 rounded-xl text-sm focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t.financePage.toDate}</label>
          <ApiDateTextInput
            label={t.financePage.toDate}
            hideLabel
            value={reportTo}
            onChange={setReportTo}
            inputClassName="px-3 py-2 bg-white border-slate-100 rounded-xl text-sm focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => void handleLoadReport()}
          disabled={reportLoading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {reportLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {t.financePage.loadReport}
        </button>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {reportRange && reportMatchesFilters ? (
              <button
                type="button"
                aria-label={`${t.financePage.totalIncome}: ${detailText.details.viewDetails}`}
                onClick={() =>
                  openDetails('income', reportRange.from, reportRange.to, report.totalIncome)
                }
                className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <p className="text-xs font-medium uppercase text-emerald-600">
                  {t.financePage.totalIncome}
                </p>
                <p className="text-2xl font-bold text-emerald-700">{fmt(report.totalIncome)} đ</p>
                <span className="mt-2 block text-xs font-semibold text-emerald-700">
                  {detailText.details.viewDetails}
                </span>
              </button>
            ) : (
              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200">
                <p className="text-xs text-emerald-600 uppercase font-medium">
                  {t.financePage.totalIncome}
                </p>
                <p className="text-2xl font-bold text-emerald-700">{fmt(report.totalIncome)} đ</p>
              </div>
            )}
            {reportRange && reportMatchesFilters ? (
              <button
                type="button"
                aria-label={`${t.financePage.totalExpenses}: ${detailText.details.viewDetails}`}
                onClick={() =>
                  openDetails('expense', reportRange.from, reportRange.to, report.totalExpenses)
                }
                className="rounded-xl border border-red-200 bg-red-50 p-4 text-left transition hover:border-red-300 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <p className="text-xs font-medium uppercase text-red-600">
                  {t.financePage.totalExpenses}
                </p>
                <p className="text-2xl font-bold text-red-700">{fmt(report.totalExpenses)} đ</p>
                <span className="mt-2 block text-xs font-semibold text-red-700">
                  {detailText.details.viewDetails}
                </span>
              </button>
            ) : (
              <div className="bg-red-50 p-4 rounded-xl border border-red-200">
                <p className="text-xs text-red-600 uppercase font-medium">
                  {t.financePage.totalExpenses}
                </p>
                <p className="text-2xl font-bold text-red-700">{fmt(report.totalExpenses)} đ</p>
              </div>
            )}
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
              <p className="text-xs text-blue-600 uppercase font-medium">{t.financePage.balance}</p>
              <p className="text-2xl font-bold text-blue-700">{fmt(report.balance)} đ</p>
            </div>
          </div>

          {reportRange && !reportMatchesFilters && (
            <p className="text-xs font-medium text-amber-700">
              {t.financePage.reloadReportDetailHint}
            </p>
          )}

          <section className="rounded-xl border border-slate-100 bg-white p-4">
            <h3 className="font-medium text-slate-700">{t.financePage.fundComposition}</h3>
            {fundCompositionTotal > 0 ? (
              <div className="mt-3 grid grid-cols-1 items-center gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)]">
                <div
                  role="img"
                  aria-label={t.financePage.fundComposition}
                  data-testid="fund-composition-chart"
                  className="h-64 min-w-0"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={fundComposition}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={92}
                        stroke="#ffffff"
                        strokeWidth={2}
                        isAnimationActive={false}
                      >
                        {fundComposition.map((item) => (
                          <Cell key={item.name} fill={item.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => `${fmt(value)} đ`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <dl className="space-y-2" aria-label={t.financePage.fundComposition}>
                  {fundComposition.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <dt className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate">{item.name}</span>
                      </dt>
                      <dd className="shrink-0 text-sm font-semibold text-slate-800">
                        {fmt(item.value)} đ
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <p className="mt-3 rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                {t.financePage.noFundComposition}
              </p>
            )}
          </section>

          {/* Income by Level & Expenses by Category Charts */}
          {((report.incomeByLevel?.length ?? 0) > 0 ||
            (report.expensesByCategory?.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(report.incomeByLevel?.length ?? 0) > 0 && (
                <div className="bg-white rounded-xl border border-slate-100 p-4">
                  <h3 className="font-medium text-slate-700 mb-3">{t.financePage.incomeByLevel}</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={(report.incomeByLevel || []).map((d) => ({
                        ...d,
                        name: d.label[language] || d.label.vi,
                      }))}
                    >
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis
                        tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip formatter={(v: number) => `${fmt(v)} đ`} />
                      <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                        {(report.incomeByLevel || []).map((_, i) => (
                          <Cell
                            key={i}
                            fill={['#10b981', '#3b82f6', '#8b5cf6', '#6b7280'][i % 4]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {(report.expensesByCategory?.length ?? 0) > 0 && (
                <div className="bg-white rounded-xl border border-slate-100 p-4">
                  <h3 className="font-medium text-slate-700 mb-3">
                    {t.financePage.expensesByCategory}
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={(report.expensesByCategory || []).map((d) => ({
                        ...d,
                        name: d.label[language] || d.label.vi,
                      }))}
                    >
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis
                        tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip formatter={(v: number) => `${fmt(v)} đ`} />
                      <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                        {(report.expensesByCategory || []).map((_, i) => (
                          <Cell
                            key={i}
                            fill={
                              ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#3b82f6', '#6b7280'][
                                i % 6
                              ]
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-slate-700">
                {breakdownMode === 'day'
                  ? t.financePage.dailyBreakdown
                  : t.financePage.monthlyBreakdown}
              </h3>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">
                  {t.financePage.aggregationMode}
                </p>
                <div
                  role="group"
                  aria-label={t.financePage.aggregationMode}
                  className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={breakdownMode === 'day'}
                    onClick={() => setBreakdownMode('day')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      breakdownMode === 'day'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.financePage.byDay}
                  </button>
                  <button
                    type="button"
                    aria-pressed={breakdownMode === 'month'}
                    onClick={() => setBreakdownMode('month')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      breakdownMode === 'month'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.financePage.byMonth}
                  </button>
                </div>
              </div>
            </div>

            {breakdownMode === 'day' ? (
              <DailyFinanceBreakdownTable
                rows={report.dailyBreakdown ?? []}
                language={language}
                t={t.financePage}
                onOpenDetails={
                  reportMatchesFilters
                    ? (type, date, expectedTotal) => openDetails(type, date, date, expectedTotal)
                    : undefined
                }
              />
            ) : (
              report.monthlyBreakdown.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-slate-600">
                        <th className="text-left px-4 py-2 font-medium">{t.financePage.month}</th>
                        <th className="text-right px-4 py-2 font-medium">{t.financePage.income}</th>
                        <th className="text-right px-4 py-2 font-medium">
                          {t.financePage.expenses}
                        </th>
                        <th className="text-right px-4 py-2 font-medium">
                          {t.financePage.balance}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.monthlyBreakdown.map((m) => (
                        <tr key={m.month} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-medium">{m.month}</td>
                          <td className="px-4 py-2 text-right text-emerald-600">
                            {fmt(m.income)} đ
                          </td>
                          <td className="px-4 py-2 text-right text-red-600">{fmt(m.expenses)} đ</td>
                          <td className="px-4 py-2 text-right font-medium">{fmt(m.balance)} đ</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </>
      )}

      {detailSelection && reportMatchesFilters && (
        <FinanceTransactionDetailsModal
          type={detailSelection.type}
          scope={{
            startDate: detailSelection.startDate,
            endDate: detailSelection.endDate,
          }}
          expectedTotal={detailSelection.expectedTotal}
          language={language}
          t={detailText}
          onClose={() => setDetailSelection(null)}
          onSummaryStale={handleSummaryStale}
        />
      )}
    </div>
  );
};
