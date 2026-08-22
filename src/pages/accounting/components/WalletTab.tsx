import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Loader2, RefreshCw, Search, WalletCards, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Class, Student } from '../../../types';
import type { WalletHistoryResponse } from '../../../types/finance';
import type { Tab } from '../constants';
import { fmt, formatDate } from '../financeUtils';
import {
  fetchWalletBalances,
  fetchWalletTransactions,
  voidWalletTransaction,
} from '../../../lib/api/financeApi';
import {
  WalletAllocationModal,
  type WalletAllocationStudent,
} from '../../../components/finance/WalletAllocationModal';
import { deriveStudentLifecycle, isArchivedLifecycle } from '../../../../shared/studentLifecycle';
import { StudentProfileLink } from './StudentProfileLink';
import { WalletHistoryModal } from './WalletHistoryModal';

type WalletBalanceRow = Awaited<ReturnType<typeof fetchWalletBalances>>['students'][number];
type StudentStatusFilter = 'active' | 'archived' | 'all';

/** Placement statuses in the chip's own vocabulary. See `statusFilters`. */
const PLACEMENT_TO_WALLET_STATUS: Record<string, string> = {
  trial: 'active',
  studying: 'active',
  on_leave: 'on_leave',
  waiting_for_placement: 'promoted',
  inactive: 'dropped',
};

interface WalletTabProps {
  activeTab: Tab;
  students: Student[];
  classes: Class[];
  language: string;
  t: any;
  onWalletChanged?: () => Promise<void> | void;
}

/**
 * Enrollment state worth flagging next to the name; active students get no
 * chip.
 *
 * Read from `placementStatus` where the server sent one. The profile's
 * `enrollmentStatus` is a projection that still says `active` for a student
 * whose course closed, so a debt nobody was chasing looked like an ordinary
 * current one — which is the case an accountant most needs the chip for.
 */
export function walletStatusChip(
  row: WalletBalanceRow
): { label: string; className: string } | null {
  if (isArchivedLifecycle(row)) {
    return { label: 'Đã nghỉ', className: 'bg-slate-100 text-slate-600' };
  }
  if (deriveStudentLifecycle(row) === 'trial' || row.placementStatus === 'trial') {
    return { label: 'Học thử', className: 'bg-amber-50 text-amber-700' };
  }

  const status = row.placementStatus
    ? PLACEMENT_TO_WALLET_STATUS[row.placementStatus]
    : row.enrollmentStatus;
  if (status === 'promoted') {
    return { label: 'Chờ lên lớp', className: 'bg-blue-50 text-blue-700' };
  }
  if (status === 'on_leave') {
    return { label: 'Bảo lưu', className: 'bg-amber-50 text-amber-700' };
  }
  if (status === 'dropped') {
    return { label: 'Đã nghỉ', className: 'bg-slate-100 text-slate-600' };
  }
  return null;
}

const statusChip = walletStatusChip;

export const WalletTab: React.FC<WalletTabProps> = ({
  activeTab,
  classes,
  language,
  t,
  onWalletChanged,
}) => {
  const [rows, setRows] = useState<WalletBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StudentStatusFilter>('active');
  const [allocationTarget, setAllocationTarget] = useState<WalletBalanceRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<WalletBalanceRow | null>(null);
  const [history, setHistory] = useState<WalletHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const reloadBalances = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWalletBalances();
      setRows(data.students);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error loading wallet balances:', error);
      toast.error(t.financePage.walletEmpty || 'Không thể tải số dư ví');
    } finally {
      setLoading(false);
    }
  }, [t.financePage.walletEmpty]);

  const reloadHistory = useCallback(async (studentId: string) => {
    setHistoryLoading(true);
    try {
      const data = await fetchWalletTransactions(studentId);
      setHistory(data);
      return data;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error loading wallet history:', error);
      toast.error('Không thể tải lịch sử ví');
      throw error;
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'wallet') void reloadBalances();
  }, [activeTab, reloadBalances]);

  const classMap = useMemo(
    () => new Map(classes.map((classRow) => [classRow.id, classRow.name])),
    [classes]
  );
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi');
    return rows.filter((row) => {
      const archived = isArchivedLifecycle(row);
      if (statusFilter === 'active' && archived) return false;
      if (statusFilter === 'archived' && !archived) return false;
      const haystack = `${row.name} ${row.code} ${row.contact || ''}`.toLocaleLowerCase('vi');
      return haystack.includes(normalizedQuery);
    });
  }, [query, rows, statusFilter]);

  const summary = useMemo(() => {
    let total = 0;
    let withBalance = 0;
    for (const row of visibleRows) {
      total += row.walletBalance;
      if (row.walletBalance > 0) withBalance += 1;
    }
    return { total, withBalance, count: visibleRows.length };
  }, [visibleRows]);

  if (activeTab !== 'wallet') return null;

  async function openHistory(row: WalletBalanceRow) {
    setHistoryTarget(row);
    setHistory(null);
    try {
      await reloadHistory(row.id);
    } catch {
      setHistoryTarget(null);
    }
  }

  async function refreshAfterMutation(studentId: string) {
    await reloadBalances();
    if (historyTarget?.id === studentId) await reloadHistory(studentId);
    await onWalletChanged?.();
  }

  async function voidAllocationGroup(
    memberId: string,
    input: { reason: string; idempotencyKey: string }
  ) {
    if (!historyTarget) return;
    try {
      await voidWalletTransaction(memberId, input.reason, input.idempotencyKey);
      await refreshAfterMutation(historyTarget.id);
      toast.success('Đã hủy lần cấn công nợ');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể hủy lần cấn công nợ');
      throw error;
    }
  }

  /**
   * The read channel hides archived classes from accounting, so the label the
   * balances endpoint resolved server-side wins; the client map is the fallback
   * for responses that predate it.
   */
  function classLabel(row: WalletBalanceRow): string {
    return row.className || classMap.get(String(row.classId || '')) || '—';
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-end">
          <label className="flex-1 space-y-1.5 text-sm font-medium text-slate-700">
            <span className="block">Tìm học sinh</span>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tên, mã học sinh hoặc số điện thoại"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm font-normal outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Xóa từ khóa tìm kiếm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span className="block">Trạng thái học sinh</span>
            <select
              aria-label="Trạng thái học sinh"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StudentStatusFilter)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100 md:w-48"
            >
              <option value="active">Đang học</option>
              <option value="archived">Đã nghỉ / lưu trữ</option>
              <option value="all">Tất cả</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void reloadBalances()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 disabled:opacity-60"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
            Tải lại
          </button>
        </div>
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-slate-100 px-4 py-3 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-slate-500">Học sinh</dt>
            <dd className="font-semibold tabular-nums text-slate-800">{fmt(summary.count)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-slate-500">Tổng số dư đang giữ</dt>
            <dd className="font-semibold tabular-nums text-emerald-700">{fmt(summary.total)} đ</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-slate-500">Học sinh còn số dư</dt>
            <dd className="font-semibold tabular-nums text-slate-800">
              {fmt(summary.withBalance)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : visibleRows.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            {t.financePage.walletEmpty || 'Không có học sinh phù hợp'}
          </p>
        ) : (
          <div className="max-h-[calc(100vh-19rem)] overflow-auto">
            <table className="w-full min-w-[920px] border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Học sinh</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Ngày sinh</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Lớp</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">
                    Số điện thoại
                  </th>
                  <th className="border-b border-l border-slate-200 px-4 py-3 text-right font-semibold">
                    Số dư ví
                  </th>
                  <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-600">
                {visibleRows.map((row) => {
                  const chip = statusChip(row);
                  const classClosed = row.classStatus === 'archived';
                  return (
                    <tr key={row.id} className="group transition-colors hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <StudentProfileLink studentId={row.id} name={row.name} />
                          {chip && (
                            <span
                              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${chip.className}`}
                            >
                              {chip.label}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-xs text-slate-400">{row.code || '—'}</span>
                      </td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-4 py-3">
                        {row.dob ? formatDate(row.dob, language) : '—'}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <span>{classLabel(row)}</span>
                        {classClosed && (
                          <span className="ml-2 whitespace-nowrap text-xs text-slate-400">
                            đã kết thúc
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-4 py-3">
                        {row.contact || '—'}
                      </td>
                      <td className="whitespace-nowrap border-b border-l border-slate-100 px-4 py-3 text-right">
                        <span
                          className={
                            row.walletBalance > 0
                              ? 'font-semibold tabular-nums text-emerald-700'
                              : 'tabular-nums text-slate-400'
                          }
                        >
                          {fmt(row.walletBalance)} đ
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setAllocationTarget(row)}
                            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                          >
                            <WalletCards size={15} />
                            Cấn công nợ
                          </button>
                          <button
                            type="button"
                            onClick={() => void openHistory(row)}
                            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
                          >
                            <History size={15} />
                            Xem lịch sử
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historyTarget && (
        <WalletHistoryModal
          student={historyTarget}
          history={history}
          loading={historyLoading}
          classes={classes}
          language={language}
          t={t}
          onClose={() => {
            setHistoryTarget(null);
            setHistory(null);
          }}
          onVoidAllocationGroup={voidAllocationGroup}
        />
      )}

      {allocationTarget && (
        <WalletAllocationModal
          student={allocationTarget as WalletAllocationStudent}
          classes={classes}
          onClose={() => setAllocationTarget(null)}
          onDone={refreshAfterMutation}
        />
      )}
    </div>
  );
};
