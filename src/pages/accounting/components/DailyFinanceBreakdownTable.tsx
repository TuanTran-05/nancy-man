import type { DailyFinanceBreakdown, FinanceDetailType } from '../../../lib/api/financeApi';
import { fmt } from '../financeUtils';

export type DailyFinanceBreakdownTableProps = {
  rows: DailyFinanceBreakdown[];
  language: string;
  t: Record<string, string>;
  onOpenDetails?: (type: FinanceDetailType, date: string, expectedTotal: number) => void;
};

function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function DailyFinanceBreakdownTable({
  rows,
  language,
  t,
  onOpenDetails,
}: DailyFinanceBreakdownTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-500">
        {t.noDailyData}
      </div>
    );
  }

  const moneyCell = (
    type: FinanceDetailType,
    row: DailyFinanceBreakdown,
    amount: number,
    className: string
  ) => {
    const label = type === 'income' ? t.totalIncome : t.totalExpenses;
    if (amount <= 0 || !onOpenDetails) {
      return <span className={className}>{fmt(amount)} đ</span>;
    }
    return (
      <button
        type="button"
        aria-label={`${label} ${formatDate(row.date, language)}`}
        onClick={() => onOpenDetails(type, row.date, amount)}
        className={`${className} font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      >
        {fmt(amount)} đ
      </button>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-3 text-left font-medium">{t.date}</th>
            <th className="px-4 py-3 text-right font-medium">{t.income}</th>
            <th className="px-4 py-3 text-right font-medium">{t.expenses}</th>
            <th className="px-4 py-3 text-right font-medium">{t.balance}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.date}>
              <td className="px-4 py-3 font-medium text-slate-700">
                {formatDate(row.date, language)}
              </td>
              <td className="px-4 py-3 text-right">
                {moneyCell('income', row, row.income, 'text-emerald-700')}
              </td>
              <td className="px-4 py-3 text-right">
                {moneyCell('expense', row, row.expenses, 'text-rose-700')}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-slate-800">
                {fmt(row.balance)} đ
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
