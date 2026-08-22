import { ChevronDown, ChevronUp } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { IncomeTransactionDetail } from '../../../../lib/api/financeApi';
import type { FinanceDetailsText } from './types';

type IncomeTransactionDetailsProps = {
  rows: IncomeTransactionDetail[];
  language: string;
  t: FinanceDetailsText;
};

function formatMoney(value: number, language: string): string {
  return `${new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(value)} đ`;
}

function formatDate(value: string, language: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

function valueOrFallback(value: string, fallback: string): string {
  return value || fallback;
}

function allocationPanel(row: IncomeTransactionDetail, language: string, t: FinanceDetailsText) {
  if (row.walletDeposit && row.allocations.length === 0) {
    return <p className="text-sm font-semibold text-emerald-700">{t.details.heldInWallet}</p>;
  }

  return (
    <div className="space-y-2">
      {row.allocations.map((allocation, index) => (
        <div
          key={`${allocation.ledgerId || 'ledger'}-${index}`}
          className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm md:grid-cols-4"
        >
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              {t.details.income.className}
            </p>
            <p className="font-semibold text-slate-900">
              {allocation.dataAvailable
                ? valueOrFallback(allocation.className, t.details.notAvailable)
                : t.details.notAvailable}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              {t.details.income.allocatedAmount}
            </p>
            <p className="font-semibold text-slate-900">
              {formatMoney(allocation.allocatedAmount, language)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              {t.details.income.amountDue}
            </p>
            <p className="font-semibold text-slate-900">
              {formatMoney(allocation.amountDue, language)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              {t.details.income.remainingAmount}
            </p>
            <p className="font-semibold text-rose-700">
              {formatMoney(allocation.remainingAmount, language)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function IncomeTransactionDetails({
  rows,
  language,
  t,
}: IncomeTransactionDetailsProps): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
        <table className="min-w-[1120px] w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">{t.details.income.receiptNo}</th>
              <th className="px-3 py-3">{t.details.income.invoiceNo}</th>
              <th className="px-3 py-3">{t.details.income.receivedDate}</th>
              <th className="px-3 py-3">{t.details.income.student}</th>
              <th className="px-3 py-3">{t.details.income.phone}</th>
              <th className="px-3 py-3">{t.details.income.paymentMethod}</th>
              <th className="px-3 py-3 text-right">{t.details.income.amountReceived}</th>
              <th className="px-3 py-3 text-right">{t.details.income.amountDue}</th>
              <th className="px-3 py-3 text-right">{t.details.income.remainingAmount}</th>
              <th className="px-3 py-3 text-right">{t.details.income.walletBalance}</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => {
              const expanded = expandedIds.has(row.id);
              const paymentMethod =
                t.details.methods[row.paymentMethod] || row.paymentMethod || t.details.notAvailable;
              return (
                <Fragment key={row.id}>
                  <tr className="align-top">
                    <td className="px-3 py-3 font-semibold text-slate-900">
                      {valueOrFallback(row.receiptNo, t.details.notAvailable)}
                    </td>
                    <td className="px-3 py-3">
                      {valueOrFallback(row.invoiceNo, t.details.notAvailable)}
                    </td>
                    <td className="px-3 py-3">{formatDate(row.receivedDate, language)}</td>
                    <td className="px-3 py-3">
                      <p>{valueOrFallback(row.studentName, t.details.notAvailable)}</p>
                      {row.studentCode && (
                        <p className="text-xs font-semibold text-slate-500">{row.studentCode}</p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {valueOrFallback(row.phone, t.details.notAvailable)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        <p>{paymentMethod}</p>
                        {row.walletDeposit && (
                          <p className="text-xs font-semibold text-emerald-700">
                            {t.details.heldInWallet}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold">
                      {formatMoney(row.amountReceived, language)}
                    </td>
                    <td className="px-3 py-3 text-right">{formatMoney(row.amountDue, language)}</td>
                    <td className="px-3 py-3 text-right text-rose-700">
                      {formatMoney(row.remainingAmount, language)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatMoney(row.walletBalance, language)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {(row.allocations.length > 0 || row.walletDeposit) && (
                        <button
                          type="button"
                          onClick={() => toggle(row.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                          {expanded ? t.details.hideAllocations : t.details.showAllocations}
                          {expanded ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={11} className="bg-slate-50 px-3 py-3">
                        {allocationPanel(row, language, t)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => {
          const expanded = expandedIds.has(row.id);
          const paymentMethod =
            t.details.methods[row.paymentMethod] || row.paymentMethod || t.details.notAvailable;
          return (
            <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">
                    {valueOrFallback(row.receiptNo, t.details.notAvailable)}
                  </p>
                  <p className="text-sm text-slate-500">{formatDate(row.receivedDate, language)}</p>
                </div>
                <p className="text-right font-bold text-emerald-700">
                  {formatMoney(row.amountReceived, language)}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.income.invoiceNo}
                  </span>
                  {valueOrFallback(row.invoiceNo, t.details.notAvailable)}
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.income.paymentMethod}
                  </span>
                  {paymentMethod}
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.income.student}
                  </span>
                  {valueOrFallback(row.studentName, t.details.notAvailable)}
                  {row.studentCode && (
                    <span className="block text-xs font-semibold text-slate-500">
                      {row.studentCode}
                    </span>
                  )}
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.income.phone}
                  </span>
                  {valueOrFallback(row.phone, t.details.notAvailable)}
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.income.amountDue}
                  </span>
                  {formatMoney(row.amountDue, language)}
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.income.remainingAmount}
                  </span>
                  <span className="font-semibold text-rose-700">
                    {formatMoney(row.remainingAmount, language)}
                  </span>
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.income.walletBalance}
                  </span>
                  {formatMoney(row.walletBalance, language)}
                </p>
                {row.walletDeposit && (
                  <p className="font-semibold text-emerald-700">{t.details.heldInWallet}</p>
                )}
              </div>
              {(row.allocations.length > 0 || row.walletDeposit) && (
                <button
                  type="button"
                  onClick={() => toggle(row.id)}
                  className="mt-3 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {expanded ? t.details.hideAllocations : t.details.showAllocations}
                  {expanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
              )}
              {expanded && <div className="mt-3">{allocationPanel(row, language, t)}</div>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
