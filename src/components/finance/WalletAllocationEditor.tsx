import React, { useMemo } from 'react';
import type { Class, CourseFeeLedger, DiscountType, Student } from '../../types';
import { ledgerAmount, ledgerRemaining } from '../../../shared/money';
import { deriveReceiptSiblingState } from './receiptSiblingState';

export type WalletAllocationDraft = {
  ledgerId: string;
  amount: number;
  discountType?: DiscountType;
  discountAmount?: number;
  discountPercent?: number;
  discountReason?: string;
  siblingDiscountWaived?: boolean;
  siblingDiscountWaivedReason?: string;
};

export type WalletAllocationEditorProps = {
  /** `className` comes from the wallet API so closed classes still have a label. */
  ledgers: Array<CourseFeeLedger & { className?: string }>;
  classes: Class[];
  selectedStudent?: Student;
  studentPool?: Student[];
  currentWalletBalance: number;
  depositAmount: number;
  value: WalletAllocationDraft[];
  onChange: (value: WalletAllocationDraft[]) => void;
  allowDiscounts?: boolean;
  autoFillSelectedAmount?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
};

const DISCOUNT_OPTIONS: Array<{ value: DiscountType; label: string; percent: number }> = [
  { value: 'none', label: 'Không học bổng', percent: 0 },
  { value: 'first_prize', label: 'Học bổng hạng nhất (10%)', percent: 10 },
  { value: 'second_prize', label: 'Học bổng hạng nhì (5%)', percent: 5 },
  { value: 'hardship', label: 'Hoàn cảnh khó khăn (20%)', percent: 20 },
  { value: 'full_waiver', label: 'Miễn giảm 100%', percent: 100 },
  { value: 'custom', label: 'Giảm tùy chọn', percent: 0 },
];

function fmt(value: number): string {
  return Number(value || 0).toLocaleString('vi-VN');
}

export function allocationDiscountAmount(
  row: WalletAllocationDraft,
  ledger: CourseFeeLedger
): number {
  if (row.discountType === 'custom') {
    if (Number(row.discountAmount || 0) > 0) return Number(row.discountAmount);
    return Math.round((ledgerAmount(ledger) * Number(row.discountPercent || 0)) / 100);
  }
  const option = DISCOUNT_OPTIONS.find((item) => item.value === row.discountType);
  return Math.round((ledgerAmount(ledger) * Number(option?.percent || 0)) / 100);
}

export function WalletAllocationEditor({
  ledgers,
  classes,
  selectedStudent,
  studentPool = [],
  currentWalletBalance,
  depositAmount,
  value,
  onChange,
  allowDiscounts = false,
  autoFillSelectedAmount = false,
  disabled = false,
  emptyMessage = 'Học sinh không còn khoản công nợ cần thanh toán.',
}: WalletAllocationEditorProps) {
  const classMap = useMemo(
    () => new Map(classes.map((classRow) => [classRow.id, classRow.name])),
    [classes]
  );
  const selectedIds = new Set(value.map((row) => row.ledgerId));
  const allocatedTotal = value.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const availableBalance = Number(currentWalletBalance || 0) + Number(depositAmount || 0);
  const endingBalance = availableBalance - allocatedTotal;
  const amountFromOpeningWallet = Math.max(0, allocatedTotal - Number(depositAmount || 0));
  const atLimit = value.length >= 20;

  function updateAllocation(ledgerId: string, patch: Partial<WalletAllocationDraft>) {
    onChange(value.map((row) => (row.ledgerId === ledgerId ? { ...row, ...patch } : row)));
  }

  function toggleLedger(ledgerId: string) {
    if (selectedIds.has(ledgerId)) {
      onChange(value.filter((row) => row.ledgerId !== ledgerId));
      return;
    }
    if (atLimit) return;
    const ledger = ledgers.find((item) => item.id === ledgerId);
    const siblingState =
      autoFillSelectedAmount && allowDiscounts && ledger
        ? deriveReceiptSiblingState({
            student: selectedStudent,
            pool: studentPool,
            ledgerAmount: ledgerAmount(ledger),
            siblingDiscountTotal: Number(ledger.siblingDiscountTotal || 0),
            discountType: 'none',
            siblingWaived: false,
          })
        : null;
    const amount =
      autoFillSelectedAmount && ledger
        ? ledgerRemaining(ledger, Number(siblingState?.siblingGrant || 0))
        : 0;
    onChange([...value, { ledgerId, amount, discountType: 'none' }]);
  }

  return (
    <section className="space-y-3" aria-label="Phân bổ công nợ">
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Chọn</th>
              <th className="px-3 py-2 font-medium">Khoản công nợ</th>
              <th className="px-3 py-2 text-right font-medium">Còn nợ</th>
              <th className="px-3 py-2 text-right font-medium">Số tiền cấn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ledgers.map((ledger) => {
              const className =
                ledger.className ||
                classMap.get(ledger.classId) ||
                ledger.classId ||
                'Không rõ lớp';
              const row = value.find((item) => item.ledgerId === ledger.id);
              const selected = Boolean(row);
              const siblingState =
                allowDiscounts && row
                  ? deriveReceiptSiblingState({
                      student: selectedStudent,
                      pool: studentPool,
                      ledgerAmount: ledgerAmount(ledger),
                      siblingDiscountTotal: Number(ledger.siblingDiscountTotal || 0),
                      discountType: row.discountType || 'none',
                      siblingWaived: Boolean(row.siblingDiscountWaived),
                    })
                  : null;
              const extraDiscount = row ? allocationDiscountAmount(row, ledger) : 0;
              const remainingAfterDiscount = ledgerRemaining(
                ledger,
                extraDiscount + Number(siblingState?.siblingGrant || 0)
              );

              return (
                <React.Fragment key={ledger.id}>
                  <tr className={selected ? 'bg-blue-50/40' : 'bg-white'}>
                    <td className="px-3 py-3 align-top">
                      <label className="inline-flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleLedger(ledger.id)}
                          disabled={disabled || (!selected && atLimit)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="sr-only">{className}</span>
                      </label>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium text-slate-800">{className}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{ledger.id}</div>
                    </td>
                    <td className="px-3 py-3 text-right align-top font-medium text-slate-700">
                      {fmt(remainingAfterDiscount)} đ
                    </td>
                    <td className="px-3 py-3 text-right align-top">
                      <input
                        type="number"
                        min={0}
                        max={remainingAfterDiscount}
                        value={selected && row?.amount ? row.amount : ''}
                        onChange={(event) =>
                          updateAllocation(ledger.id, { amount: Number(event.target.value || 0) })
                        }
                        onWheel={(event) => event.currentTarget.blur()}
                        aria-label={`Số tiền cấn - ${className}`}
                        disabled={disabled || !selected || row?.discountType === 'full_waiver'}
                        className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                      />
                    </td>
                  </tr>
                  {selected && allowDiscounts && row && (
                    <tr className="bg-blue-50/20">
                      <td />
                      <td colSpan={3} className="px-3 pb-4">
                        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-2">
                          <label className="space-y-1 text-sm font-medium text-slate-700">
                            <span>Học bổng / Giảm giá - {className}</span>
                            <select
                              value={row.discountType || 'none'}
                              onChange={(event) => {
                                const discountType = event.target.value as DiscountType;
                                updateAllocation(ledger.id, {
                                  discountType,
                                  amount: discountType === 'full_waiver' ? 0 : row.amount,
                                  discountAmount: 0,
                                  discountPercent: 0,
                                  discountReason: '',
                                });
                              }}
                              disabled={disabled}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                            >
                              {DISCOUNT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          {row.discountType === 'custom' && (
                            <>
                              <label className="space-y-1 text-sm text-slate-700">
                                <span>Giảm theo % - {className}</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={row.discountPercent || ''}
                                  onChange={(event) =>
                                    updateAllocation(ledger.id, {
                                      discountPercent: Number(event.target.value || 0),
                                      discountAmount: 0,
                                    })
                                  }
                                  onWheel={(event) => event.currentTarget.blur()}
                                  disabled={disabled || Number(row.discountAmount || 0) > 0}
                                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                                />
                              </label>
                              <label className="space-y-1 text-sm text-slate-700">
                                <span>Hoặc giảm số tiền - {className}</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={row.discountAmount || ''}
                                  onChange={(event) =>
                                    updateAllocation(ledger.id, {
                                      discountAmount: Number(event.target.value || 0),
                                      discountPercent: 0,
                                    })
                                  }
                                  onWheel={(event) => event.currentTarget.blur()}
                                  disabled={disabled || Number(row.discountPercent || 0) > 0}
                                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                                />
                              </label>
                              <label className="space-y-1 text-sm text-slate-700 md:col-span-2">
                                <span>Lý do giảm giá - {className}</span>
                                <input
                                  value={row.discountReason || ''}
                                  onChange={(event) =>
                                    updateAllocation(ledger.id, {
                                      discountReason: event.target.value,
                                    })
                                  }
                                  disabled={disabled}
                                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                                />
                              </label>
                            </>
                          )}

                          {siblingState?.eligibility.eligible &&
                            siblingState.availableSiblingGrant > 0 &&
                            row.discountType !== 'full_waiver' && (
                              <div className="space-y-2 md:col-span-2">
                                <p className="text-sm text-emerald-700">
                                  Học bổng anh em có thể áp dụng:{' '}
                                  {fmt(siblingState.availableSiblingGrant)} đ
                                </p>
                                <label className="flex items-center gap-2 text-sm text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(row.siblingDiscountWaived)}
                                    onChange={(event) =>
                                      updateAllocation(ledger.id, {
                                        siblingDiscountWaived: event.target.checked,
                                        siblingDiscountWaivedReason: '',
                                      })
                                    }
                                    disabled={disabled}
                                  />
                                  Không áp dụng học bổng anh em
                                </label>
                                {row.siblingDiscountWaived && (
                                  <label className="block space-y-1 text-sm text-slate-700">
                                    <span>Lý do không áp dụng - {className}</span>
                                    <input
                                      value={row.siblingDiscountWaivedReason || ''}
                                      onChange={(event) =>
                                        updateAllocation(ledger.id, {
                                          siblingDiscountWaivedReason: event.target.value,
                                        })
                                      }
                                      disabled={disabled}
                                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                                    />
                                  </label>
                                )}
                              </div>
                            )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {ledgers.length === 0 && (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{emptyMessage}</p>
      )}
      {atLimit && ledgers.some((ledger) => !selectedIds.has(ledger.id)) && (
        <p className="text-sm font-medium text-amber-700">
          Mỗi lần chỉ được chọn tối đa 20 khoản công nợ.
        </p>
      )}

      <dl className="grid gap-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-slate-500">Số dư khả dụng</dt>
          <dd className="font-semibold text-slate-800">{fmt(availableBalance)} đ</dd>
        </div>
        <div>
          <dt className="text-slate-500">Tổng đã phân bổ</dt>
          <dd data-testid="wallet-allocated-total" className="font-semibold text-slate-800">
            {fmt(allocatedTotal)} đ
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Dùng từ số dư ví cũ</dt>
          <dd className="font-semibold text-slate-800">{fmt(amountFromOpeningWallet)} đ</dd>
        </div>
        <div>
          <dt className="text-slate-500">Số dư sau phân bổ</dt>
          <dd
            data-testid="wallet-ending-balance"
            className={`font-semibold ${endingBalance < 0 ? 'text-rose-600' : 'text-emerald-700'}`}
          >
            {fmt(endingBalance)} đ
          </dd>
        </div>
      </dl>
    </section>
  );
}
