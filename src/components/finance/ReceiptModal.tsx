import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import type {
  Class,
  CourseFeeLedger,
  PaymentMethod,
  Student,
  UserProfile,
  WalletStudentContext,
} from '../../types';
import { createAndPostReceipt, fetchWalletStudentContext } from '../../lib/api/financeApi';
import { ModalPortal } from '../common/ModalPortal';
import { DateTimeTextInput } from '../forms/DateTimeTextInput';
import { apiDateToDisplayDate, normalizeDateLikeToApiDate } from '../../lib/core/utils';
import { ledgerRemaining } from '../../../shared/money';
import {
  allocationDiscountAmount,
  WalletAllocationEditor,
  type WalletAllocationDraft,
} from './WalletAllocationEditor';
import { deriveReceiptSiblingState } from './receiptSiblingState';

const DEFAULT_RECEIPT_AMOUNT = 1_000_000;

export type ReceiptModalStudentTarget = Pick<Student, 'id' | 'name' | 'code'>;

type ReceiptModalBaseProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  classes: Class[];
  students: Student[];
  ledgers: CourseFeeLedger[];
  teachers?: Pick<UserProfile, 'uid' | 'displayName'>[];
  studentDirectoryLoading?: boolean;
  studentDirectoryError?: string | null;
  onRetryStudentDirectory?: () => void;
};

export type ReceiptModalProps =
  | (ReceiptModalBaseProps & {
      mode: 'fixed';
      targetStudent: ReceiptModalStudentTarget;
    })
  | (ReceiptModalBaseProps & {
      mode: 'selectable';
      targetStudent?: never;
    });

function newIdempotencyKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function ReceiptModal(props: ReceiptModalProps) {
  const {
    isOpen,
    onClose,
    onSuccess,
    classes,
    students,
    studentDirectoryLoading = false,
    studentDirectoryError = null,
    onRetryStudentDirectory,
  } = props;
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const requestSequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [studentId, setStudentId] = useState('');
  const [walletContext, setWalletContext] = useState<WalletStudentContext | null>(null);
  const [allocations, setAllocations] = useState<WalletAllocationDraft[]>([]);
  const [amountReceived, setAmountReceived] = useState(DEFAULT_RECEIPT_AMOUNT);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [receivedDate, setReceivedDate] = useState(
    apiDateToDisplayDate(new Date().toISOString().slice(0, 10))
  );
  const [note, setNote] = useState('');
  const fixedStudentId = props.mode === 'fixed' ? props.targetStudent.id : '';

  useEffect(() => {
    if (!isOpen) return;
    requestSequence.current += 1;
    setLoading(false);
    setContextLoading(false);
    setContextError(null);
    setIdempotencyKey(newIdempotencyKey());
    setStudentId(fixedStudentId);
    setWalletContext(null);
    setAllocations([]);
    setAmountReceived(DEFAULT_RECEIPT_AMOUNT);
    setPaymentMethod('cash');
    setReceivedDate(apiDateToDisplayDate(new Date().toISOString().slice(0, 10)));
    setNote('');
    if (fixedStudentId) void selectStudent(fixedStudentId);
  }, [isOpen, fixedStudentId]);

  const selectedStudent = students.find((student) => student.id === studentId);
  const referenceDataReady =
    !studentDirectoryLoading && !studentDirectoryError && Boolean(selectedStudent);
  const ledgerMap = useMemo(
    () => new Map((walletContext?.ledgers || []).map((ledger) => [ledger.id, ledger])),
    [walletContext]
  );
  const allocatedTotal = allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const availableBalance = Number(walletContext?.walletBalance || 0) + Number(amountReceived || 0);

  const allocationsValid = allocations.every((row) => {
    const ledger = ledgerMap.get(row.ledgerId);
    if (!ledger) return false;
    if (row.discountType === 'full_waiver') return Number(row.amount || 0) === 0;
    if (Number(row.amount || 0) <= 0) return false;
    if (
      row.discountType === 'custom' &&
      (!String(row.discountReason || '').trim() ||
        (Number(row.discountPercent || 0) <= 0 && Number(row.discountAmount || 0) <= 0))
    ) {
      return false;
    }
    if (row.siblingDiscountWaived && !String(row.siblingDiscountWaivedReason || '').trim()) {
      return false;
    }
    const siblingState = deriveReceiptSiblingState({
      student: selectedStudent,
      pool: students,
      ledgerAmount: Number(ledger.amount || 0),
      siblingDiscountTotal: Number(ledger.siblingDiscountTotal || 0),
      discountType: row.discountType || 'none',
      siblingWaived: Boolean(row.siblingDiscountWaived),
    });
    return (
      Number(row.amount || 0) <=
      ledgerRemaining(
        ledger,
        allocationDiscountAmount(row, ledger) + Number(siblingState.siblingGrant || 0)
      )
    );
  });
  const canSave =
    Boolean(studentId && walletContext && idempotencyKey) &&
    referenceDataReady &&
    !contextLoading &&
    !loading &&
    amountReceived >= 0 &&
    (amountReceived > 0 || allocations.length > 0) &&
    allocations.length <= 20 &&
    allocationsValid &&
    allocatedTotal <= availableBalance;

  async function selectStudent(nextStudentId: string) {
    const sequence = ++requestSequence.current;
    setStudentId(nextStudentId);
    setAllocations([]);
    setWalletContext(null);
    setContextError(null);
    if (!nextStudentId) return;
    setContextLoading(true);
    try {
      const context = await fetchWalletStudentContext(nextStudentId);
      if (sequence === requestSequence.current) setWalletContext(context);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      const message = error instanceof Error ? error.message : t.receiptModal.createFailed;
      setContextError(message);
      toast.error(message);
    } finally {
      if (sequence === requestSequence.current) setContextLoading(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    try {
      setLoading(true);
      await createAndPostReceipt({
        flowVersion: 'wallet-manual-v2',
        idempotencyKey,
        studentId,
        amountReceived: Number(amountReceived),
        paymentMethod,
        receivedDate: normalizeDateLikeToApiDate(receivedDate),
        note: note || '',
        allocations: allocations.map((row) => {
          const ledger = ledgerMap.get(row.ledgerId);
          const baseDiscount = ledger ? allocationDiscountAmount(row, ledger) : 0;
          const siblingState = ledger
            ? deriveReceiptSiblingState({
                student: selectedStudent,
                pool: students,
                ledgerAmount: Number(ledger.amount || 0),
                siblingDiscountTotal: Number(ledger.siblingDiscountTotal || 0),
                discountType: row.discountType || 'none',
                siblingWaived: Boolean(row.siblingDiscountWaived),
              })
            : null;
          return {
            ledgerId: row.ledgerId,
            amount: Number(row.amount || 0),
            ...(row.discountType && row.discountType !== 'none'
              ? { discountType: row.discountType }
              : {}),
            ...(baseDiscount > 0 && row.discountType !== 'full_waiver'
              ? { discountAmount: baseDiscount }
              : {}),
            ...(Number(row.discountPercent || 0) > 0
              ? { discountPercent: Number(row.discountPercent) }
              : {}),
            ...(String(row.discountReason || '').trim()
              ? { discountReason: String(row.discountReason).trim() }
              : {}),
            ...(siblingState?.siblingGrant ? { siblingDiscount: true } : {}),
            ...(row.siblingDiscountWaived
              ? {
                  siblingDiscountWaived: true,
                  siblingDiscountWaivedReason: String(row.siblingDiscountWaivedReason || '').trim(),
                }
              : {}),
          };
        }),
      });
      toast.success(t.receiptModal.createSuccess);
      onSuccess?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.receiptModal.createFailed);
      void selectStudent(studentId);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  const dialogTitle =
    props.mode === 'fixed' ? `Thu tiền — ${props.targetStudent.name}` : t.receiptModal.createTitle;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-4">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={dialogTitle}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-4 sm:px-6">
            <h2 className="text-xl font-bold text-slate-800">{dialogTitle}</h2>
            <button
              type="button"
              aria-label={t.common.close}
              onClick={onClose}
              className="rounded-full p-2 transition-colors hover:bg-slate-100"
            >
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-5 overflow-y-auto p-5 sm:p-6">
            <div className="grid gap-4 md:grid-cols-2">
              {props.mode === 'fixed' ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                  <div className="text-xs font-medium uppercase text-slate-500">Học sinh</div>
                  <div className="font-semibold text-slate-800">{props.targetStudent.name}</div>
                  <div className="text-xs text-slate-500">
                    {props.targetStudent.code || props.targetStudent.id}
                  </div>
                </div>
              ) : (
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>{t.common.student}</span>
                  <select
                    required
                    value={studentId}
                    onChange={(event) => void selectStudent(event.target.value)}
                    disabled={loading}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">{t.receiptModal.selectStudent}</option>
                    {[...students]
                      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
                      .map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.name} ({student.code || student.studentId})
                        </option>
                      ))}
                  </select>
                </label>
              )}

              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Số tiền thực thu (VNĐ)</span>
                <input
                  type="number"
                  min={0}
                  step={100_000}
                  value={amountReceived || ''}
                  onChange={(event) => setAmountReceived(Number(event.target.value || 0))}
                  onWheel={(event) => event.currentTarget.blur()}
                  disabled={loading}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>

            {studentDirectoryLoading && (
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang tải thông tin học sinh...
              </div>
            )}

            {studentDirectoryError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                <span>{studentDirectoryError}</span>
                <button
                  type="button"
                  onClick={onRetryStudentDirectory}
                  className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-1.5 font-medium text-rose-700"
                >
                  Thử lại
                </button>
              </div>
            )}

            {contextError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                <span>{contextError}</span>
                <button
                  type="button"
                  onClick={() => void selectStudent(studentId)}
                  className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-1.5 font-medium text-rose-700"
                >
                  Tải lại công nợ
                </button>
              </div>
            )}

            {contextLoading && (
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang tải công nợ của học sinh...
              </div>
            )}

            {walletContext && (
              <WalletAllocationEditor
                ledgers={walletContext.ledgers}
                classes={classes}
                selectedStudent={selectedStudent}
                studentPool={students}
                currentWalletBalance={walletContext.walletBalance}
                depositAmount={amountReceived}
                value={allocations}
                onChange={setAllocations}
                allowDiscounts
                autoFillSelectedAmount
                disabled={loading}
                emptyMessage="Học sinh không còn khoản công nợ cần thanh toán. Số tiền thu sẽ được giữ trong ví."
              />
            )}

            {allocatedTotal > availableBalance && (
              <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                Tổng phân bổ vượt quá số dư khả dụng.
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>{t.receiptModal.methodLabel}</span>
                <select
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                  disabled={loading}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="cash">{t.receiptModal.cash}</option>
                  <option value="transfer">{t.receiptModal.transfer}</option>
                  <option value="other">{t.receiptModal.other}</option>
                </select>
              </label>

              <DateTimeTextInput
                mode="date"
                label={t.receiptModal.receivedDate}
                value={receivedDate}
                onChange={setReceivedDate}
                required
                disabled={loading}
              />
            </div>

            <label className="block space-y-1 text-sm font-medium text-slate-700">
              <span>{t.receiptModal.noteLabel}</span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t.receiptModal.noteAdditionalPlaceholder}
                disabled={loading}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded-xl px-5 py-2 font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {loading ? t.receiptModal.saving : t.receiptModal.saveAndPost}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
