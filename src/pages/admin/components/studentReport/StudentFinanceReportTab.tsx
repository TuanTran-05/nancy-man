import React, { useState } from 'react';
import { StudentLedgerReceipts } from './StudentLedgerReceipts';
import type { StudentCourseFinanceSummary } from '../../../../../shared/accountingStudentFinance';
import { updateStudentCourseEnrollment } from '../../../../lib/api/studentAdminApi';
import { CourseEnrollmentEditorModal } from './CourseEnrollmentEditorModal';

type LedgerRow = {
  id: string;
  periodKey: string;
  classId: string | null;
  termKey: string | null;
  termStart: string | null;
  termEnd: string | null;
  termLabel: string | null;
  dueDate: string | null;
  grossAmount: number;
  discount: number;
  netAmount: number;
  paid: number;
  outstanding: number;
  displayStatus: string;
  isOverdue: boolean;
  hasDueDate: boolean;
};

type ReceiptRow = {
  id: string;
  ledgerId: string;
  receiptNumber: string | null;
  date: string | null;
  amount: number;
  method: string | null;
  status: string | null;
  source: string | null;
};

type FinanceSummary = {
  grossAmount: number;
  discountTotal: number;
  netAmount: number;
  paidTotal: number;
  outstandingTotal: number;
  unpaidTerms: number;
  overdueTerms: number;
  missingDueDateTerms: number;
};

type Props = {
  financeSummary: FinanceSummary;
  ledgers: LedgerRow[];
  receipts: ReceiptRow[];
  t: any;
  courseSummaries?: StudentCourseFinanceSummary[];
  canCorrectEnrollment?: boolean;
  onEnrollmentCorrected?: () => void;
};

function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function formatPeriod(ledger: LedgerRow, t: any): string {
  if (ledger.termLabel) return ledger.termLabel;
  if (ledger.termStart) {
    return `${ledger.termStart} – ${ledger.termEnd || t.filters.ongoing}`;
  }
  return t.filters.termUnknown;
}

const STATUS_COLORS: Record<string, string> = {
  waived: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  unpaid: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  due_date_missing: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

export const StudentFinanceReportTab: React.FC<Props> = ({
  financeSummary,
  ledgers,
  receipts,
  t,
  courseSummaries = [],
  canCorrectEnrollment = false,
  onEnrollmentCorrected,
}) => {
  const ft = t.finance;
  const [editingEnrollment, setEditingEnrollment] = useState<
    StudentCourseFinanceSummary['enrollment'] | null
  >(null);

  if (ledgers.length === 0 && courseSummaries.length === 0) {
    return (
      <div className="text-center py-12 text-muted text-sm" id="finance-empty-state">
        {ft.emptyLabel}
      </div>
    );
  }

  return (
    <div>
      {courseSummaries.length > 0 && (
        <div
          className="mb-6 overflow-x-auto rounded-2xl border border-border-light"
          id="finance-course-summary-table"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 text-muted text-xs">
                <th className="px-4 py-3 text-left">Lớp / khóa</th>
                <th className="px-4 py-3 text-left">Trạng thái học</th>
                <th className="px-4 py-3 text-center">Đã học</th>
                <th className="px-4 py-3 text-center">Tổng buổi</th>
                <th className="px-4 py-3 text-right">Đã đóng</th>
                <th className="px-4 py-3 text-right">Còn thiếu</th>
                <th className="px-4 py-3 text-left">Thanh toán</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {courseSummaries.map((course) => (
                <tr key={course.enrollment.id} className="border-t border-border-light">
                  <td className="px-4 py-3 font-medium">{course.className}</td>
                  <td className="px-4 py-3">
                    {course.enrollment.status}
                    {course.enrollment.confidence === 'inferred' && (
                      <span className="ml-1 text-[10px] text-amber-600">(suy luận)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {course.sessions.complete === false
                      ? 'Chưa đủ dữ liệu'
                      : `${course.sessions.attended}/${course.sessions.elapsed}`}
                  </td>
                  <td className="px-4 py-3 text-center">{course.sessions.elapsed}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">
                    {formatVnd(course.finance.paid)}
                  </td>
                  <td className="px-4 py-3 text-right text-rose-600">
                    {formatVnd(course.finance.outstanding)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                      {course.finance.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canCorrectEnrollment && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-indigo-600 hover:underline"
                        onClick={() => setEditingEnrollment(course.enrollment)}
                      >
                        {course.enrollment.confidence === 'inferred' ? 'Xác nhận' : 'Sửa'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CourseEnrollmentEditorModal
        open={Boolean(editingEnrollment)}
        enrollment={editingEnrollment}
        role={canCorrectEnrollment ? 'office' : undefined}
        onClose={() => setEditingEnrollment(null)}
        onSave={async ({ status, joinedAt, endedAt, statusReason }) => {
          if (!editingEnrollment) return;
          await updateStudentCourseEnrollment({
            enrollmentId: editingEnrollment.id,
            status,
            joinedAt,
            endedAt,
            statusReason,
          });
          onEnrollmentCorrected?.();
        }}
      />
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          {
            id: 'fin-gross',
            label: ft.grossLabel,
            value: formatVnd(financeSummary.grossAmount),
            color: 'text-heading',
          },
          {
            id: 'fin-discount',
            label: ft.discountLabel,
            value: formatVnd(financeSummary.discountTotal),
            color: 'text-amber-600',
          },
          {
            id: 'fin-paid',
            label: ft.paidLabel,
            value: formatVnd(financeSummary.paidTotal),
            color: 'text-emerald-600',
          },
          {
            id: 'fin-outstanding',
            label: ft.outstandingLabel,
            value: formatVnd(financeSummary.outstandingTotal),
            color: financeSummary.outstandingTotal > 0 ? 'text-rose-600' : 'text-emerald-600',
          },
        ].map((card) => (
          <div key={card.id} id={card.id} className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4">
            <p className="text-xs text-muted mb-1">{card.label}</p>
            <p className={`font-bold text-base ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Warnings */}
      {financeSummary.unpaidTerms > 0 && (
        <div className="mb-3 text-sm text-amber-600 font-medium" id="finance-warning-unpaid">
          · {ft.unpaidTerms.replace('{count}', String(financeSummary.unpaidTerms))}
          {financeSummary.overdueTerms > 0 &&
            ` · ${ft.overdueTerms.replace('{count}', String(financeSummary.overdueTerms))}`}
          {financeSummary.missingDueDateTerms > 0 &&
            ` · ${ft.missingDueDate.replace('{count}', String(financeSummary.missingDueDateTerms))}`}
        </div>
      )}

      {/* Ledger table */}
      <div
        className="overflow-x-auto rounded-2xl border border-border-light"
        id="finance-ledger-table"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800 text-muted text-xs">
              <th className="px-4 py-3 text-left font-semibold">{ft.table.period}</th>
              <th className="px-4 py-3 text-right font-semibold">{ft.table.gross}</th>
              <th className="px-4 py-3 text-right font-semibold">{ft.table.discount}</th>
              <th className="px-4 py-3 text-right font-semibold">{ft.table.paid}</th>
              <th className="px-4 py-3 text-right font-semibold">{ft.table.outstanding}</th>
              <th className="px-4 py-3 text-left font-semibold">{ft.table.dueDate}</th>
              <th className="px-4 py-3 text-left font-semibold">{ft.table.status}</th>
            </tr>
          </thead>
          <tbody>
            {ledgers.map((ledger) => (
              <React.Fragment key={ledger.id}>
                <tr className="border-t border-border-light hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-medium">{formatPeriod(ledger, t)}</td>
                  <td className="px-4 py-3 text-right">{formatVnd(ledger.grossAmount)}</td>
                  <td className="px-4 py-3 text-right text-amber-600">
                    {ledger.discount > 0 ? `-${formatVnd(ledger.discount)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-600">
                    {formatVnd(ledger.paid)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${ledger.outstanding > 0 ? 'text-rose-600' : 'text-muted'}`}
                  >
                    {formatVnd(ledger.outstanding)}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {ledger.hasDueDate ? (
                      ledger.dueDate
                    ) : (
                      <span className="text-slate-400 text-xs">{ft.statuses.due_date_missing}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[ledger.displayStatus] ?? ''}`}
                    >
                      {ft.statuses[ledger.displayStatus as keyof typeof ft.statuses] ??
                        ledger.displayStatus}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td colSpan={7} className="px-4 pb-3">
                    <StudentLedgerReceipts ledgerId={ledger.id} receipts={receipts} t={t} />
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
