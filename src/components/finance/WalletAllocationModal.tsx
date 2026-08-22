import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Class, WalletStudentContext } from '../../types';
import { allocateStudentWallet, fetchWalletStudentContext } from '../../lib/api/financeApi';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';
import { WalletAllocationEditor, type WalletAllocationDraft } from './WalletAllocationEditor';

export type WalletAllocationStudent = {
  id: string;
  name: string;
  code: string;
  walletBalance: number;
};

export type WalletAllocationModalProps = {
  student: WalletAllocationStudent;
  classes: Class[];
  onClose: () => void;
  onDone: (studentId: string) => Promise<void> | void;
};

function operationKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `wallet-allocation-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function WalletAllocationModal({
  student,
  classes,
  onClose,
  onDone,
}: WalletAllocationModalProps) {
  useBodyScrollLock(true);
  const [context, setContext] = useState<WalletStudentContext | null>(null);
  const [allocations, setAllocations] = useState<WalletAllocationDraft[]>([]);
  const [idempotencyKey] = useState(operationKey);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchWalletStudentContext(student.id)
      .then((nextContext) => {
        if (active) setContext(nextContext);
      })
      .catch((error) => {
        if (!active) return;
        toast.error(error instanceof Error ? error.message : 'Không thể tải công nợ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [student.id]);

  const allocatedTotal = useMemo(
    () => allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [allocations]
  );
  const valid =
    Boolean(context && allocations.length > 0 && idempotencyKey) &&
    allocations.every((row) => Number(row.amount || 0) > 0) &&
    allocatedTotal <= Number(context?.walletBalance || 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    try {
      setSaving(true);
      await allocateStudentWallet({
        idempotencyKey,
        studentId: student.id,
        allocations: allocations.map((row) => ({
          ledgerId: row.ledgerId,
          amount: Number(row.amount || 0),
        })),
      });
      await onDone(student.id);
      toast.success('Đã cấn công nợ từ số dư ví');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể cấn công nợ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cấn công nợ"
          className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        >
          <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Cấn công nợ</h2>
              <p className="mt-1 text-sm text-slate-500">
                {student.name} ({student.code})
              </p>
            </div>
            <button
              type="button"
              aria-label="Đóng"
              onClick={onClose}
              disabled={saving}
              className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4 overflow-y-auto p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 size={18} className="animate-spin" />
                Đang tải công nợ...
              </div>
            ) : context ? (
              <WalletAllocationEditor
                ledgers={context.ledgers}
                classes={classes}
                currentWalletBalance={context.walletBalance}
                depositAmount={0}
                value={allocations}
                onChange={setAllocations}
                allowDiscounts={false}
                disabled={saving}
              />
            ) : (
              <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                Không thể tải dữ liệu ví của học sinh.
              </p>
            )}

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={!valid || saving}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Xác nhận cấn công nợ
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
