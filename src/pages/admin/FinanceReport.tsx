import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Loader2, WalletCards } from 'lucide-react';
import { dateToApiMonthInTimeZone } from '../../../shared/dateTimeFormat';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import {
  fetchCenterFinanceReport,
  type CenterFinanceReport,
  type FinanceDetailType,
} from '../../lib/api/financeApi';
import { FinanceKpiRow } from './components/financeReport/FinanceKpiRow';
import { FinanceTransactionDetailsModal } from './components/financeReport/FinanceTransactionDetailsModal';
import { RevenueWaterfallChart } from './components/financeReport/RevenueWaterfallChart';
import { MonthlyTrendChart } from './components/financeReport/MonthlyTrendChart';
import { CategoryBreakdownCharts } from './components/financeReport/CategoryBreakdownCharts';
import { ReceivablesByStatusChart } from './components/financeReport/ReceivablesByStatusChart';
import { StudentPaymentSection } from './components/financeReport/StudentPaymentSection';
import { ClassTuitionReconciliationSection } from './components/financeReport/ClassTuitionReconciliationSection';
import type { FinanceReportText } from './components/financeReport/types';

function currentMonth(): string {
  return dateToApiMonthInTimeZone(new Date());
}

const TREND_OPTIONS = [6, 12, 24];

type ReportRequestState =
  | { key: string; status: 'success'; report: CenterFinanceReport }
  | { key: string; status: 'error'; errorCode?: string; message?: string };

export default function FinanceReport() {
  const { language } = useLanguage();
  const t = translations[language].adminFinanceReport as FinanceReportText;
  const [month, setMonth] = useState(currentMonth());
  const [months, setMonths] = useState(12);
  const [requestState, setRequestState] = useState<ReportRequestState | null>(null);
  const [detailType, setDetailType] = useState<FinanceDetailType | null>(null);
  const requestKey = `${month}:${months}`;
  const visibleState = requestState?.key === requestKey ? requestState : null;

  useEffect(() => {
    let active = true;
    fetchCenterFinanceReport(month, months)
      .then((report) => {
        if (active) setRequestState({ key: requestKey, status: 'success', report });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const typedError = error as { errorCode?: string };
        setRequestState({
          key: requestKey,
          status: 'error',
          errorCode: typedError.errorCode,
          message: error instanceof Error ? error.message : undefined,
        });
      });
    return () => {
      active = false;
    };
  }, [month, months, requestKey]);

  useEffect(() => {
    setDetailType(null);
  }, [month]);

  const refreshVisibleReport = useCallback(async () => {
    try {
      const report = await fetchCenterFinanceReport(month, months);
      setRequestState((current) =>
        current?.key === requestKey ? { key: requestKey, status: 'success', report } : current
      );
    } catch {
      // Keep the last successful summary; the next normal request will surface errors.
    }
  }, [month, months, requestKey]);

  const errorMessage =
    visibleState?.status === 'error'
      ? visibleState.errorCode === 'report_too_large'
        ? t.tooLarge
        : visibleState.message || t.noData
      : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-3">
            <Link
              to="/admin"
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" /> {t.backToDashboard}
            </Link>
            <Link
              to="/tuition"
              className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              <WalletCards className="h-4 w-4" /> {t.openWorkspace}
            </Link>
          </div>
          <h1 className="text-2xl font-black text-heading">{t.title}</h1>
          <p className="text-sm text-subtle">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs font-semibold text-slate-500">
            {t.month}
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value || currentMonth())}
              className="mt-1 h-11 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"
            />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-500">
            {t.trendLength}
            <select
              value={months}
              onChange={(event) => setMonths(Number(event.target.value))}
              className="mt-1 h-11 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"
            >
              {TREND_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {visibleState?.status === 'success' && !errorMessage ? (
        <>
          <FinanceKpiRow report={visibleState.report} t={t} onOpenDetails={setDetailType} />
          {detailType && (
            <FinanceTransactionDetailsModal
              type={detailType}
              scope={{ month }}
              expectedTotal={
                detailType === 'income'
                  ? visibleState.report.current.cashIn
                  : visibleState.report.current.cashOut
              }
              language={language}
              t={t}
              onClose={() => setDetailType(null)}
              onSummaryStale={() => void refreshVisibleReport()}
            />
          )}
        </>
      ) : !visibleState ? (
        <div className="flex items-center gap-2 p-10 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> {t.loading}
        </div>
      ) : errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-600">
          {errorMessage}
        </div>
      ) : (
        <div className="p-10 text-slate-400">{t.noData}</div>
      )}

      {/*
        Rendered unconditionally as a sibling: the month request key flips
        `visibleState` to null on every month change, and mounting this block inside
        the success branch would unmount it and drop the selected class/course.
      */}
      <ClassTuitionReconciliationSection language={language} t={t.classReconciliation} />

      {visibleState?.status === 'success' && !errorMessage && (
        <>
          <StudentPaymentSection report={visibleState.report} t={t} language={language} />
          <div className="grid gap-5 lg:grid-cols-2">
            <RevenueWaterfallChart report={visibleState.report} t={t} />
            <MonthlyTrendChart report={visibleState.report} t={t} />
            <CategoryBreakdownCharts report={visibleState.report} t={t} language={language} />
            <ReceivablesByStatusChart report={visibleState.report} t={t} />
          </div>
          <p className="text-xs leading-relaxed text-slate-400">{t.footnote}</p>
        </>
      )}
    </div>
  );
}
