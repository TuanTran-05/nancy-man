import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, Loader2, Phone, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { ModalPortal } from '../common/ModalPortal';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { cn } from '../../lib/core/utils';

type Step = 'input' | 'otp' | 'verified';

interface ProfilePhoneOtpModalProps {
  isOpen: boolean;
  mode: 'add' | 'change';
  step: Step;
  email: string;
  currentPhoneDisplay: string;
  newPhone: string;
  otp: string;
  error: string | null;
  isProcessing: boolean;
  resendTimer: number;
  labels: {
    addTitle: string;
    changeTitle: string;
    accountEmail: string;
    newPhone: string;
    currentPhone: string;
    verifiedNewPhone: string;
    sendOtp: string;
    verifyOtp: string;
    confirmChange: string;
    otpCode: string;
    otpSentHint: string;
    resendOtp: string;
    resendIn: string;
    contactAdminHint: string;
    verifiedTitle: string;
    noCurrentPhone: string;
    cancel: string;
  };
  onClose: () => void;
  onNewPhoneChange: (value: string) => void;
  onOtpChange: (value: string) => void;
  onRequestOtp: (e: React.FormEvent) => void;
  onVerifyOtp: (e: React.FormEvent) => void;
  onConfirm: () => void;
  onResend: () => void;
}

export function ProfilePhoneOtpModal({
  isOpen,
  mode,
  step,
  email,
  currentPhoneDisplay,
  newPhone,
  otp,
  error,
  isProcessing,
  resendTimer,
  labels,
  onClose,
  onNewPhoneChange,
  onOtpChange,
  onRequestOtp,
  onVerifyOtp,
  onConfirm,
  onResend,
}: ProfilePhoneOtpModalProps) {
  useBodyScrollLock(isOpen);
  const title = mode === 'add' ? labels.addTitle : labels.changeTitle;

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800"
            >
              <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                    <Phone className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-5 p-5">
                <div className="space-y-2">
                  <label
                    htmlFor="profile-phone-email"
                    className="text-sm font-bold text-slate-700 dark:text-slate-200"
                  >
                    {labels.accountEmail}
                  </label>
                  <input
                    id="profile-phone-email"
                    value={email}
                    readOnly
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  />
                </div>

                {step === 'input' && (
                  <form className="space-y-5" onSubmit={onRequestOtp}>
                    <div className="space-y-2">
                      <label
                        htmlFor="profile-new-phone"
                        className="text-sm font-bold text-slate-700 dark:text-slate-200"
                      >
                        {labels.newPhone}
                      </label>
                      <input
                        id="profile-new-phone"
                        value={newPhone}
                        onChange={(e) => onNewPhoneChange(e.target.value)}
                        inputMode="tel"
                        autoComplete="tel"
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </div>
                    {error && (
                      <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                        {error}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={isProcessing || !newPhone.trim()}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-60"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      {labels.sendOtp}
                    </button>
                  </form>
                )}

                {step === 'otp' && (
                  <form className="space-y-5" onSubmit={onVerifyOtp}>
                    <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                      {labels.otpSentHint.replace('{phone}', newPhone)}
                    </p>
                    <div className="space-y-2">
                      <label
                        htmlFor="profile-phone-otp"
                        className="text-sm font-bold text-slate-700 dark:text-slate-200"
                      >
                        {labels.otpCode}
                      </label>
                      <input
                        id="profile-phone-otp"
                        value={otp}
                        onChange={(e) => onOtpChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-xl font-bold tracking-[0.4em] text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </div>
                    <p className="text-sm text-slate-500">{labels.contactAdminHint}</p>
                    {error && (
                      <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                        {error}
                      </p>
                    )}
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={onResend}
                        disabled={isProcessing || resendTimer > 0}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 font-bold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                      >
                        <RotateCcw className="h-4 w-4" />
                        {resendTimer > 0
                          ? labels.resendIn.replace('{seconds}', String(resendTimer))
                          : labels.resendOtp}
                      </button>
                      <button
                        type="submit"
                        disabled={isProcessing || otp.length !== 6}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-60"
                      >
                        {isProcessing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        {labels.verifyOtp}
                      </button>
                    </div>
                  </form>
                )}

                {step === 'verified' && (
                  <div className="space-y-5">
                    <div className="rounded-xl bg-emerald-50 p-4 text-emerald-700">
                      <div className="flex items-center gap-2 font-bold">
                        <CheckCircle className="h-5 w-5" />
                        {labels.verifiedTitle}
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                        <p className="text-xs font-bold uppercase text-slate-400">
                          {labels.currentPhone}
                        </p>
                        <p className="font-bold text-slate-800 dark:text-white">
                          {currentPhoneDisplay || labels.noCurrentPhone}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                        <p className="text-xs font-bold uppercase text-slate-400">
                          {labels.verifiedNewPhone}
                        </p>
                        <p className="font-bold text-slate-800 dark:text-white">{newPhone}</p>
                      </div>
                    </div>
                    {error && (
                      <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                        {error}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={onConfirm}
                      disabled={isProcessing}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-60"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      {labels.confirmChange}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
