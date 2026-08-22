import type { ExpenseTransactionDetail } from '../../../../lib/api/financeApi';
import type { FinanceDetailsText } from './types';

type ExpenseTransactionDetailsProps = {
  rows: ExpenseTransactionDetail[];
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

export function ExpenseTransactionDetails({
  rows,
  language,
  t,
}: ExpenseTransactionDetailsProps): React.ReactElement {
  const classLabel = t.details.expense.className || t.details.income.className;

  return (
    <div className="space-y-4">
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
        <table className="min-w-[1080px] w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">{t.details.expense.expenseNo}</th>
              <th className="px-3 py-3">{t.details.expense.paidDate}</th>
              <th className="px-3 py-3">{t.details.expense.category}</th>
              <th className="px-3 py-3">{t.details.expense.content}</th>
              <th className="px-3 py-3 text-right">{t.details.expense.amount}</th>
              <th className="px-3 py-3">{t.details.expense.payee}</th>
              <th className="px-3 py-3">{t.details.expense.createdBy}</th>
              <th className="px-3 py-3">{t.details.expense.student}</th>
              <th className="px-3 py-3">{classLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => {
              const content = row.purpose || row.reason || row.note || t.details.notAvailable;
              const creator = row.createdByName || row.createdBy || t.details.notAvailable;
              const category =
                t.details.categories[row.category] || row.category || t.details.notAvailable;
              return (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {valueOrFallback(row.expenseNo, t.details.notAvailable)}
                  </td>
                  <td className="px-3 py-3">{formatDate(row.paidDate, language)}</td>
                  <td className="px-3 py-3">{category}</td>
                  <td className="px-3 py-3">{content}</td>
                  <td className="px-3 py-3 text-right font-semibold text-rose-700">
                    {formatMoney(row.amount, language)}
                  </td>
                  <td className="px-3 py-3">
                    {valueOrFallback(row.payee, t.details.notAvailable)}
                  </td>
                  <td className="px-3 py-3">{creator}</td>
                  <td className="px-3 py-3">
                    {row.type === 'wallet_refund' ? (
                      <div>
                        <p>{valueOrFallback(row.studentName, t.details.notAvailable)}</p>
                        {row.walletBalance !== null && (
                          <p className="text-xs font-semibold text-slate-500">
                            {t.details.income.walletBalance}:{' '}
                            {formatMoney(row.walletBalance, language)}
                          </p>
                        )}
                      </div>
                    ) : (
                      t.details.notAvailable
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {valueOrFallback(row.className, t.details.notAvailable)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => {
          const content = row.purpose || row.reason || row.note || t.details.notAvailable;
          const creator = row.createdByName || row.createdBy || t.details.notAvailable;
          const category =
            t.details.categories[row.category] || row.category || t.details.notAvailable;
          return (
            <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">
                    {valueOrFallback(row.expenseNo, t.details.notAvailable)}
                  </p>
                  <p className="text-sm text-slate-500">{formatDate(row.paidDate, language)}</p>
                </div>
                <p className="text-right font-bold text-rose-700">
                  {formatMoney(row.amount, language)}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.expense.category}
                  </span>
                  {category}
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.expense.content}
                  </span>
                  {content}
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.expense.payee}
                  </span>
                  {valueOrFallback(row.payee, t.details.notAvailable)}
                </p>
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {t.details.expense.createdBy}
                  </span>
                  {creator}
                </p>
                {row.type === 'wallet_refund' && (
                  <p className="col-span-2">
                    <span className="block text-xs font-semibold uppercase text-slate-500">
                      {t.details.expense.student}
                    </span>
                    {valueOrFallback(row.studentName, t.details.notAvailable)}
                    {row.walletBalance !== null && (
                      <span className="block text-xs font-semibold text-slate-500">
                        {t.details.income.walletBalance}: {formatMoney(row.walletBalance, language)}
                      </span>
                    )}
                  </p>
                )}
                <p>
                  <span className="block text-xs font-semibold uppercase text-slate-500">
                    {classLabel}
                  </span>
                  {valueOrFallback(row.className, t.details.notAvailable)}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
