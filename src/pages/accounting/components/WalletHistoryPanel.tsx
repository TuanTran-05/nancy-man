import { useMemo, useState } from 'react';
import type { Class } from '../../../types';
import type { WalletHistoryResponse, WalletTransaction } from '../../../types/finance';
import { VoidReasonDialog } from '../../../components/finance/VoidReasonDialog';
import { fmt, formatDate } from '../financeUtils';

type HistoryRow = WalletHistoryResponse['transactions'][number];

export type WalletHistoryPanelProps = {
  history: WalletHistoryResponse;
  classes: Class[];
  language: string;
  t: any;
  onVoidAllocationGroup: (
    memberId: string,
    input: { reason: string; idempotencyKey: string }
  ) => Promise<void>;
};

const STATUS_LABELS: Record<WalletTransaction['status'], string> = {
  proposed: 'Chờ duyệt',
  posted: 'Đã chốt',
  rejected: 'Đã từ chối',
  void: 'Đã hủy',
};

function statusLabel(transaction: WalletTransaction, t: any): string {
  if (transaction.status === 'void') return t.financePage.walletTxVoided || STATUS_LABELS.void;
  return STATUS_LABELS[transaction.status] || transaction.status;
}

function transactionLabel(transaction: WalletTransaction, t: any): string {
  const labels: Record<string, string> = {
    deposit: t.financePage.walletTxDeposit || 'Nạp ví',
    allocation: t.financePage.walletTxAllocation || 'Cấn công nợ',
    credit: t.financePage.walletTxCredit || 'Cộng ví',
    refund: t.financePage.walletTxRefund || 'Hoàn tiền',
    adjustment: t.financePage.walletTxAdjustment || 'Điều chỉnh',
  };
  return labels[transaction.type] || transaction.type;
}

export function WalletHistoryPanel({
  history,
  classes,
  language,
  t,
  onVoidAllocationGroup,
}: WalletHistoryPanelProps) {
  const [voidTarget, setVoidTarget] = useState<{ memberId: string; groupId: string } | null>(null);
  const classMap = useMemo(
    () => new Map(classes.map((classRow) => [classRow.id, classRow.name])),
    [classes]
  );
  const groups = useMemo(() => {
    const result = new Map<string, HistoryRow[]>();
    history.transactions.forEach((row) => {
      const groupId = String(row.transactionGroupId || row.id);
      const rows = result.get(groupId) || [];
      rows.push(row);
      result.set(groupId, rows);
    });
    return result;
  }, [history.transactions]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-slate-700">Số dư đầu kỳ</span>
          <span className="font-semibold text-slate-900">
            {fmt(history.opening?.balance || 0)} đ
          </span>
        </div>
        {history.opening?.startedAt && (
          <div className="mt-1 text-xs text-slate-500">
            Từ {formatDate(history.opening.startedAt, language)}
          </div>
        )}
      </div>

      {history.transactions.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Chưa có giao dịch ví trong kỳ.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Giao dịch</th>
                <th className="px-3 py-2 font-medium">Chứng từ / Công nợ</th>
                <th className="px-3 py-2 font-medium">Ghi chú / Người tạo</th>
                <th className="px-3 py-2 text-right font-medium">Biến động</th>
                <th className="px-3 py-2 text-right font-medium">Số dư sau GD</th>
                <th className="px-3 py-2 font-medium">Trạng thái / Ngày</th>
                <th className="px-3 py-2 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.transactions.map((row) => {
                const groupId = String(row.transactionGroupId || row.id);
                const group = groups.get(groupId) || [row];
                const isGroupHead = group[0]?.id === row.id;
                const canVoidGroup =
                  isGroupHead &&
                  group.every(
                    (member) =>
                      member.schemaVersion === 2 &&
                      member.source === 'manual_allocation' &&
                      member.type === 'allocation' &&
                      member.status === 'posted'
                  );
                const amountClass =
                  row.signedAmount > 0
                    ? 'text-emerald-600'
                    : row.signedAmount < 0
                      ? 'text-rose-600'
                      : 'text-slate-500';
                const amountLabel = `${row.signedAmount > 0 ? '+' : ''}${fmt(row.signedAmount)} đ`;
                const reference =
                  row.receiptNo ||
                  row.expenseNo ||
                  row.className ||
                  classMap.get(String(row.classId || '')) ||
                  row.ledgerId ||
                  '—';

                return (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-800">{transactionLabel(row, t)}</div>
                      {group.length > 1 && (
                        <div className="mt-0.5 text-xs text-slate-400">
                          Nhóm {groupId} ({group.length} dòng)
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <div>{reference}</div>
                      {row.ledgerId && (
                        <div className="mt-0.5 font-mono text-xs text-slate-400">
                          {row.ledgerId}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <div>{row.note || row.reason || '—'}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {row.createdByName || row.createdBy || '—'}
                      </div>
                    </td>
                    <td className={`px-3 py-3 text-right font-semibold ${amountClass}`}>
                      {amountLabel}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-slate-800">
                      {fmt(row.balanceAfter)} đ
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <div>{statusLabel(row, t)}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {formatDate(row.createdAt, language)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {canVoidGroup && (
                        <button
                          type="button"
                          onClick={() => setVoidTarget({ memberId: row.id, groupId })}
                          className="text-sm font-medium text-rose-600 hover:text-rose-700"
                        >
                          Hủy lần cấn công nợ
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <VoidReasonDialog
        isOpen={Boolean(voidTarget)}
        title="Hủy lần cấn công nợ"
        message="Toàn bộ các dòng trong lần cấn công nợ này sẽ được hoàn tác."
        confirmLabel="Xác nhận hủy"
        operationPrefix="allocation-void"
        onClose={() => setVoidTarget(null)}
        onConfirm={async (input) => {
          if (!voidTarget) return;
          await onVoidAllocationGroup(voidTarget.memberId, input);
        }}
      />
    </div>
  );
}
