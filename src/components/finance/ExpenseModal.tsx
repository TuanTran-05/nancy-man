import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { useAuth } from '../../contexts/AuthContext';
import { createAndPostExpense, fetchWalletStudentContext } from '../../lib/api/financeApi';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';
import { DateTimeTextInput } from '../forms/DateTimeTextInput';
import { apiDateToDisplayDate, normalizeDateLikeToApiDate } from '../../lib/core/utils';
import type { Student } from '../../types';

const EXPENSE_CATEGORY_VALUES = [
  'salary',
  'rent',
  'utilities',
  'marketing',
  'supplies',
  'other',
] as const;

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  students?: Student[];
}

export function ExpenseModal({ isOpen, onClose, students = [] }: ExpenseModalProps) {
  useBodyScrollLock(isOpen);
  const { language, t } = useLanguage();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'activity' | 'wallet_refund'>('activity');
  const [category, setCategory] = useState('other');
  const [studentId, setStudentId] = useState('');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [amount, setAmount] = useState<number>(0);
  const [paidDate, setPaidDate] = useState(
    apiDateToDisplayDate(new Date().toISOString().slice(0, 10))
  );
  const [payee, setPayee] = useState('');
  const [note, setNote] = useState('');
  const [purpose, setPurpose] = useState('');
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const walletRequestVersion = useRef(0);

  useEffect(() => {
    if (isOpen) {
      setMode('activity');
      setCategory('other');
      setStudentId('');
      setWalletBalance(null);
      setWalletLoading(false);
      setAmount(0);
      setPaidDate(apiDateToDisplayDate(new Date().toISOString().slice(0, 10)));
      setPayee('');
      setNote('');
      setPurpose('');
      setReason('');
      setValidationError('');
      setIdempotencyKey(
        globalThis.crypto?.randomUUID?.() ||
          `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
    }
  }, [isOpen]);

  useEffect(() => {
    const requestVersion = ++walletRequestVersion.current;
    setWalletBalance(null);
    setValidationError('');
    if (!isOpen || mode !== 'wallet_refund' || !studentId) {
      setWalletLoading(false);
      return;
    }

    setWalletLoading(true);
    fetchWalletStudentContext(studentId)
      .then((context) => {
        if (walletRequestVersion.current !== requestVersion) return;
        setWalletBalance(context.walletBalance);
      })
      .catch(() => {
        if (walletRequestVersion.current !== requestVersion) return;
        setValidationError(
          language === 'vi'
            ? 'Không thể tải số dư ví của học sinh.'
            : 'Unable to load the student wallet balance.'
        );
      })
      .finally(() => {
        if (walletRequestVersion.current === requestVersion) setWalletLoading(false);
      });
  }, [isOpen, language, mode, studentId]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');
    if (mode === 'wallet_refund') {
      if (!studentId) {
        setValidationError(
          language === 'vi' ? 'Vui lòng chọn học sinh.' : 'Please select a student.'
        );
        return;
      }
      if (!reason.trim()) {
        setValidationError(
          language === 'vi' ? 'Vui lòng nhập lý do hoàn tiền.' : 'Please enter a refund reason.'
        );
        return;
      }
      if (amount <= 0) {
        setValidationError(
          language === 'vi' ? 'Số tiền phải lớn hơn 0.' : 'Amount must be positive.'
        );
        return;
      }
      if (!payee.trim()) {
        setValidationError(
          language === 'vi' ? 'Vui lòng nhập người nhận.' : 'Please enter a payee.'
        );
        return;
      }
      if (walletLoading || walletBalance === null) {
        setValidationError(
          language === 'vi'
            ? 'Vui lòng chờ tải số dư ví.'
            : 'Please wait for the wallet balance to load.'
        );
        return;
      }
      if (amount > walletBalance) {
        setValidationError(
          language === 'vi'
            ? 'Số tiền hoàn vượt quá số dư ví.'
            : 'Refund amount exceeds the wallet balance.'
        );
        return;
      }
    } else {
      if (amount <= 0 || !payee) return;
      if (category === 'other' && !purpose.trim()) return;
    }

    try {
      setLoading(true);

      const paidDateForApi = normalizeDateLikeToApiDate(paidDate);
      const result =
        mode === 'wallet_refund'
          ? await createAndPostExpense({
              idempotencyKey,
              type: 'wallet_refund',
              studentId,
              amount: Number(amount),
              paidDate: paidDateForApi,
              payee: payee.trim(),
              reason: reason.trim(),
              note: note || '',
            })
          : await createAndPostExpense({
              idempotencyKey,
              category,
              amount: Number(amount),
              paidDate: paidDateForApi,
              payee,
              note: note || '',
              purpose: category === 'other' ? purpose.trim() : '',
            });
      if (result.expenseNo) {
        toast.success(`Expense ${result.expenseNo} created successfully!`);
      } else {
        toast.success(t.expenseModal.success);
      }

      onClose();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error creating expense:', err);
      toast.error(t.expenseModal.failure);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-xl max-h-[90vh] flex flex-col"
        >
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
            <h2 className="text-xl font-bold text-slate-800">{t.expenseModal.createTitle}</h2>
            <button
              type="button"
              aria-label={t.evaluationModal.close}
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
            <div>
              <label
                htmlFor="expense-mode"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                {language === 'vi' ? 'Loại phiếu chi' : 'Expense type'}
              </label>
              <select
                id="expense-mode"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as 'activity' | 'wallet_refund');
                  setValidationError('');
                }}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="activity">
                  {language === 'vi' ? 'Chi phí hoạt động' : 'Activity expense'}
                </option>
                <option value="wallet_refund">
                  {language === 'vi' ? 'Hoàn tiền học sinh' : 'Student wallet refund'}
                </option>
              </select>
            </div>

            {mode === 'wallet_refund' ? (
              <>
                <div>
                  <label
                    htmlFor="expense-student"
                    className="block text-sm font-medium text-slate-700 mb-1"
                  >
                    {language === 'vi' ? 'Học sinh' : 'Student'}
                  </label>
                  <select
                    id="expense-student"
                    value={studentId}
                    onChange={(event) => setStudentId(event.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">
                      {language === 'vi' ? 'Chọn học sinh' : 'Select a student'}
                    </option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.name} ({student.code || student.studentId || student.id})
                      </option>
                    ))}
                  </select>
                </div>
                <div
                  className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800"
                  aria-live="polite"
                >
                  <span className="font-medium">
                    {language === 'vi' ? 'Số dư ví' : 'Wallet balance'}:
                  </span>{' '}
                  {walletLoading
                    ? language === 'vi'
                      ? 'Đang tải...'
                      : 'Loading...'
                    : walletBalance === null
                      ? '—'
                      : `${new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(
                          walletBalance
                        )} ₫`}
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t.expenseModal.categoryLabel}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {EXPENSE_CATEGORY_VALUES.map((catValue) => (
                      <option key={catValue} value={catValue}>
                        {t.expenseModal.categories[catValue]}
                      </option>
                    ))}
                  </select>
                </div>

                {category === 'other' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t.expenseModal.purposeLabel} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder={t.expenseModal.example}
                    />
                  </div>
                )}
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="expense-amount"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  {t.expenseModal.amountLabel}
                </label>
                <input
                  id="expense-amount"
                  type="number"
                  required={mode === 'activity'}
                  min="1"
                  value={amount || ''}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <DateTimeTextInput
                mode="date"
                label={t.expenseModal.dateLabel}
                value={paidDate}
                onChange={setPaidDate}
                required
              />
            </div>

            <div>
              <label
                htmlFor="expense-payee"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                {t.expenseModal.payeeLabel}
              </label>
              <input
                id="expense-payee"
                type="text"
                required={mode === 'activity'}
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder={t.expenseModal.payeePlaceholder}
              />
            </div>

            {mode === 'wallet_refund' && (
              <div>
                <label
                  htmlFor="expense-refund-reason"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  {language === 'vi' ? 'Lý do hoàn tiền' : 'Refund reason'}
                  <span className="text-red-500"> *</span>
                </label>
                <textarea
                  id="expense-refund-reason"
                  aria-required="true"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t.expenseModal.noteLabel}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder={t.expenseModal.notePlaceholder}
              />
            </div>

            {validationError && (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {validationError}
              </p>
            )}

            <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-6 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={loading || (mode === 'wallet_refund' && walletLoading)}
                className="px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {loading ? t.expenseModal.saving : t.expenseModal.saveAndPost}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
