import { Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ModalPortal } from '../../../../components/common/ModalPortal';
import {
  fetchCenterFinanceReportDetails,
  type CenterReportDetailsResponse,
  type FinanceDetailType,
  type FinanceDetailsScope,
} from '../../../../lib/api/financeApi';
import { ExpenseTransactionDetails } from './ExpenseTransactionDetails';
import { IncomeTransactionDetails } from './IncomeTransactionDetails';
import type { FinanceDetailsText } from './types';

export type FinanceTransactionDetailsModalProps = {
  type: FinanceDetailType;
  scope: FinanceDetailsScope;
  expectedTotal: number;
  language: string;
  t: FinanceDetailsText;
  onClose: () => void;
  onSummaryStale: () => void;
};

type ModalState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; response: CenterReportDetailsResponse };

function formatMoney(value: number, language: string): string {
  return `${new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(value)} đ`;
}

function formatDateLabel(isoDate: string, language: string): string {
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

function formatPeriodLabel(scope: FinanceDetailsScope, language: string): string {
  if ('month' in scope) return scope.month;
  if (scope.startDate === scope.endDate) return formatDateLabel(scope.startDate, language);
  return `${formatDateLabel(scope.startDate, language)} - ${formatDateLabel(scope.endDate, language)}`;
}

export function FinanceTransactionDetailsModal({
  type,
  scope,
  expectedTotal,
  language,
  t,
  onClose,
  onSummaryStale,
}: FinanceTransactionDetailsModalProps): ReactElement {
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<ModalState>({ status: 'loading' });
  const staleReportedRef = useRef(false);
  const cursor = cursorStack[cursorStack.length - 1];

  const month = 'month' in scope ? scope.month : undefined;
  const startDate = 'startDate' in scope ? scope.startDate : undefined;
  const endDate = 'endDate' in scope ? scope.endDate : undefined;
  const scopeKey = month ? `month:${month}` : `range:${startDate}:${endDate}`;

  useEffect(() => {
    setCursorStack([null]);
    setRequestVersion(0);
    staleReportedRef.current = false;
  }, [scopeKey, type]);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });

    const requestScope: FinanceDetailsScope = month
      ? { month }
      : { startDate: startDate!, endDate: endDate! };

    fetchCenterFinanceReportDetails({
      ...requestScope,
      type,
      pageSize: 25,
      cursor,
    })
      .then((response) => {
        if (!active) return;
        setState({ status: 'success', response });
        if (response.totalAmount !== expectedTotal && !staleReportedRef.current) {
          staleReportedRef.current = true;
          onSummaryStale();
        }
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [cursor, endDate, expectedTotal, month, onSummaryStale, requestVersion, startDate, type]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const response = state.status === 'success' ? state.response : null;
  const title = type === 'income' ? t.details.incomeTitle : t.details.expenseTitle;
  const periodLabel = formatPeriodLabel(scope, language);

  return (
    <ModalPortal trapFocus lockScroll>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-0 sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="relative z-10 flex h-full w-full flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-7xl sm:rounded-2xl"
        >
          <header className="flex items-start justify-between border-b border-slate-200 px-4 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-black text-heading">{title}</h2>
              <p className="mt-1 text-sm text-subtle">
                {periodLabel}
                {response
                  ? ` · ${t.details.transactionCount}: ${response.totalCount} · ${t.details.totalAmount}: ${formatMoney(response.totalAmount, language)}`
                  : ''}
              </p>
            </div>
            <button
              type="button"
              aria-label={t.details.close}
              onClick={onClose}
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <main className="flex-1 overflow-auto px-4 py-4 sm:px-6">
            {state.status === 'loading' && (
              <div className="flex items-center justify-center gap-2 py-16 text-subtle">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t.details.loading}
              </div>
            )}
            {state.status === 'error' && (
              <div className="py-16 text-center">
                <p className="text-sm text-rose-700">{t.details.loadError}</p>
                <button
                  type="button"
                  onClick={() => setRequestVersion((value) => value + 1)}
                  className="mt-3 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {t.details.retry}
                </button>
              </div>
            )}
            {response && response.rows.length === 0 && (
              <p className="py-16 text-center text-sm text-subtle">
                {response.type === 'income' ? t.details.emptyIncome : t.details.emptyExpense}
              </p>
            )}
            {response?.type === 'income' && response.rows.length > 0 && (
              <IncomeTransactionDetails rows={response.rows} language={language} t={t} />
            )}
            {response?.type === 'expense' && response.rows.length > 0 && (
              <ExpenseTransactionDetails rows={response.rows} language={language} t={t} />
            )}
          </main>

          <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6">
            <button
              type="button"
              disabled={cursorStack.length === 1}
              onClick={() => setCursorStack((current) => current.slice(0, -1))}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 hover:not-disabled:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {t.details.previousPage}
            </button>
            <span className="text-sm text-subtle">
              {t.details.page} {cursorStack.length}
            </span>
            <button
              type="button"
              disabled={!response?.nextCursor}
              onClick={() => {
                const nextCursor = response?.nextCursor;
                if (nextCursor) {
                  setCursorStack((current) => [...current, nextCursor]);
                }
              }}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 hover:not-disabled:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {t.details.nextPage}
            </button>
          </footer>
        </div>
        <button
          type="button"
          aria-label={t.details.close}
          className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
          onClick={onClose}
        />
      </div>
    </ModalPortal>
  );
}
