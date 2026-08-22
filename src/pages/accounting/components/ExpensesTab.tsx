import React from 'react';
import { Plus, Loader2, CheckCircle, XCircle } from 'lucide-react';
import type { Expense } from '../../../types';
import type { Tab } from '../constants';
import { STATUS_COLORS, STATUS_LABELS } from '../constants';
import { fmt, formatDate } from '../financeUtils';

interface ExpensesTabProps {
  activeTab: Tab;
  setShowExpenseModal: (v: boolean) => void;
  filteredExpenses: Expense[];
  actionLoading: string | null;
  handlePostExpense: (id: string) => void;
  handleVoidExpense: (id: string) => void;
  expensesHasMore: boolean;
  expensesLoading: boolean;
  loadExpenses: (mode: 'append') => void;
  language: string;
  t: any;
}

export const ExpensesTab: React.FC<ExpensesTabProps> = ({
  activeTab,
  setShowExpenseModal,
  filteredExpenses,
  actionLoading,
  handlePostExpense,
  handleVoidExpense,
  expensesHasMore,
  expensesLoading,
  loadExpenses,
  language,
  t,
}) => {
  if (activeTab !== 'expenses') return null;

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowExpenseModal(true)}
        className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-xl text-sm font-medium hover:bg-rose-700 transition-colors"
      >
        <Plus size={16} />
        {t.financePage.createExpense}
      </button>

      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.expenseNo}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.category}
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">
                  {t.financePage.amount}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.payee}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.expenseDate}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {t.financePage.details}
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">
                  {t.financePage.status}
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">
                  {t.financePage.actions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    {t.financePage.noExpenses}
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((e) => {
                  const refundStudentName = String(
                    (e as Expense & { studentName?: string }).studentName || e.studentId || ''
                  );
                  const catLabels: Record<string, string> = {
                    salary: t.financePage.catSalary,
                    rent: t.financePage.catRent,
                    utilities: t.financePage.catUtilities,
                    marketing: 'Marketing',
                    supplies: t.financePage.catSupplies,
                    other: t.financePage.methodOther,
                    wallet_refund:
                      language === 'vi' ? 'Hoàn tiền học sinh' : 'Student wallet refund',
                  };
                  return (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs">{e.expenseNo}</td>
                      <td className="px-4 py-3">{catLabels[e.category] || e.category}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(e.amount)} đ</td>
                      <td className="px-4 py-3">
                        {e.type === 'wallet_refund' ? (
                          <>
                            <div className="font-medium text-slate-700">
                              {refundStudentName || '—'}
                            </div>
                            <div className="text-xs text-slate-500">{e.payee}</div>
                          </>
                        ) : (
                          e.payee
                        )}
                      </td>
                      <td className="px-4 py-3">{formatDate(e.paidDate, language)}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 max-w-[200px] truncate">
                        {e.type === 'wallet_refund'
                          ? e.reason || '—'
                          : e.category === 'other'
                            ? e.purpose || '—'
                            : e.note || '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[e.status] || ''}`}
                        >
                          {STATUS_LABELS[e.status]?.[language] || e.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {e.status === 'draft' && (
                            <button
                              onClick={() => handlePostExpense(e.id)}
                              disabled={actionLoading === e.id}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                              title={t.financePage.post}
                            >
                              {actionLoading === e.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <CheckCircle size={14} />
                              )}
                            </button>
                          )}
                          {e.status === 'posted' && (
                            <button
                              onClick={() => handleVoidExpense(e.id)}
                              disabled={actionLoading === e.id}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              title={t.financePage.voidAction}
                            >
                              {actionLoading === e.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <XCircle size={14} />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {expensesHasMore && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => loadExpenses('append')}
            disabled={expensesLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {expensesLoading && <Loader2 size={16} className="animate-spin" />}
            {language === 'vi' ? 'Tải thêm chi phí' : 'Load more expenses'}
          </button>
        </div>
      )}
    </div>
  );
};
