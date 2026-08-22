import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, X, Clock, ShieldAlert, CheckCircle2, Lock, Send, Phone } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { useMotionSafe } from '../../hooks/useMotionSafe';
import { Magnetic } from '../common/Magnetic';

interface ForgotPasswordModalProps {
  show: boolean;
  onClose: () => void;
  T: { forgotModal: Record<string, string> };
  language: string;
  forgotStatus: {
    type: 'idle' | 'loading' | 'otp_sent' | 'otp_verified' | 'success' | 'error';
    message?: string;
  };
  setForgotStatus: (status: {
    type: 'idle' | 'loading' | 'otp_sent' | 'otp_verified' | 'success' | 'error';
    message?: string;
  }) => void;
  resetMethod: 'phone' | 'zalo' | 'request';
  setResetMethod: (method: 'phone' | 'zalo' | 'request') => void;
  forgotId: string;
  setForgotId: (val: string) => void;
  forgotPhone: string;
  setForgotPhone: (val: string) => void;
  otpCode: string;
  setOtpCode: (val: string) => void;
  newPassword: string;
  setNewPassword: (val: string) => void;
  confirmNewPassword: string;
  setConfirmNewPassword: (val: string) => void;
  isProcessingForgot: boolean;
  handleForgotPassword: (e: React.FormEvent) => void;
  handleVerifyOtp: (e: React.FormEvent) => void;
  handleResetPassword: (e: React.FormEvent) => void;
  resendTimer: number;
}

export function ForgotPasswordModal(props: ForgotPasswordModalProps) {
  const {
    show,
    onClose,
    T,
    language,
    forgotStatus,
    setForgotStatus,
    resetMethod,
    setResetMethod,
    forgotId,
    setForgotId,
    forgotPhone,
    setForgotPhone,
    otpCode,
    setOtpCode,
    newPassword,
    setNewPassword,
    confirmNewPassword,
    setConfirmNewPassword,
    isProcessingForgot,
    handleForgotPassword,
    handleVerifyOtp,
    handleResetPassword,
    resendTimer,
  } = props;

  const { t } = useLanguage();
  useBodyScrollLock(show);
  const { shouldReduceMotion } = useMotionSafe();

  return (
    <ModalPortal>
      <AnimatePresence>
        {show && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
            />
            <motion.div
              initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.94, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { scale: 0.94, opacity: 0, y: 12 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 380, damping: 26 }
              }
              className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 dark:border-slate-700/50 z-10"
            >
              <div className="bg-blue-600 dark:bg-blue-600/90 p-6 flex items-center justify-between text-white relative">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md border border-white/20">
                    <HelpCircle className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-xl font-bold">{T.forgotModal.title}</h2>
                </div>
                <button
                  type="button"
                  aria-label={t.forgotPasswordModal.closeLabel}
                  onClick={onClose}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors border border-transparent hover:border-white/20"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div id="recaptcha-container"></div>

                {forgotStatus.type === 'error' ? (
                  <div className="text-center space-y-6 py-8">
                    <div
                      className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto shadow-lg ${
                        forgotStatus.message === T.forgotModal.pendingMessage
                          ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 shadow-amber-100'
                          : 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 shadow-red-100'
                      }`}
                    >
                      {forgotStatus.message === T.forgotModal.pendingMessage ? (
                        <Clock className="w-12 h-12" />
                      ) : (
                        <ShieldAlert className="w-12 h-12" />
                      )}
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-2xl font-black text-slate-850 dark:text-slate-100 uppercase tracking-tight">
                        {forgotStatus.message === T.forgotModal.pendingMessage
                          ? T.forgotModal.pendingTitle
                          : T.forgotModal.errorTitle}
                      </h3>
                      <p className="text-slate-500 dark:text-slate-400 leading-relaxed px-4 text-sm font-medium">
                        {forgotStatus.message}
                      </p>
                    </div>
                    <Magnetic>
                      <button
                        onClick={() => setForgotStatus({ type: 'idle' })}
                        className="w-full py-4 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all border border-slate-200 dark:border-slate-600 shadow-sm"
                      >
                        {T.forgotModal.back}
                      </button>
                    </Magnetic>
                  </div>
                ) : forgotStatus.type === 'success' ? (
                  <div className="text-center space-y-4 py-4">
                    <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-100">
                      <CheckCircle2 className="w-10 h-10" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        {T.forgotModal.success}
                      </h3>
                      <p className="text-slate-500 dark:text-slate-400 font-medium">
                        {forgotStatus.message}
                      </p>
                    </div>
                  </div>
                ) : forgotStatus.type === 'otp_verified' ? (
                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-2xl flex items-start space-x-3 mb-2">
                      <ShieldAlert className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium leading-relaxed">
                        {T.forgotModal.otpVerified}
                      </p>
                    </div>
                    <div className="space-y-5">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1 mb-1.5">
                          {T.forgotModal.newPassword}
                        </label>
                        <div className="relative group">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 w-5 h-5 group-focus-within:text-emerald-500 transition-colors" />
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 dark:focus:border-emerald-500 outline-none transition-all placeholder:text-slate-300 dark:text-slate-100"
                            placeholder={T.forgotModal.passwordPlaceholder}
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1 mb-1.5">
                          {T.forgotModal.confirmPassword}
                        </label>
                        <div className="relative group">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 w-5 h-5 group-focus-within:text-emerald-500 transition-colors" />
                          <input
                            type="password"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 dark:focus:border-emerald-500 outline-none transition-all placeholder:text-slate-300 dark:text-slate-100"
                            placeholder={T.forgotModal.confirmPlaceholder}
                            required
                          />
                        </div>
                      </div>
                    </div>
                    <Magnetic>
                      <button
                        type="submit"
                        disabled={isProcessingForgot}
                        className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 mt-6"
                      >
                        {isProcessingForgot
                          ? T.forgotModal.submitting
                          : t.forgotPasswordModal.changePassword}
                      </button>
                    </Magnetic>
                  </form>
                ) : forgotStatus.type === 'otp_sent' ? (
                  <form onSubmit={handleVerifyOtp} className="space-y-6">
                    <div className="p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-2xl flex items-start space-x-3">
                      <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-blue-700 dark:text-blue-450 font-medium leading-relaxed">
                        {forgotStatus.message}
                      </p>
                    </div>
                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center">
                        {t.forgotPasswordModal.otpLabel}
                      </label>
                      <input
                        type="text"
                        value={otpCode}
                        onChange={(e) =>
                          setOtpCode(e.target.value.replace(/\D/g, '').substring(0, 6))
                        }
                        className="w-full px-4 py-5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-3xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-center text-4xl font-black tracking-[0.5em] shadow-inner font-mono dark:text-slate-100"
                        placeholder="000000"
                        required
                      />
                    </div>
                    <div className="space-y-4">
                      <Magnetic>
                        <button
                          type="submit"
                          disabled={isProcessingForgot || otpCode.length !== 6}
                          className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-xl active:scale-[0.98] disabled:opacity-50"
                        >
                          {isProcessingForgot
                            ? t.forgotPasswordModal.verifying
                            : t.forgotPasswordModal.confirmOTP}
                        </button>
                      </Magnetic>
                      <div className="text-center">
                        {resendTimer > 0 ? (
                          <div className="flex items-center justify-center space-x-2 text-slate-400 dark:text-slate-500">
                            <Clock className="w-3 h-3" />
                            <p className="text-[11px] font-bold">
                              {t.forgotPasswordModal.resendAfter.replace(
                                '{seconds}',
                                String(resendTimer)
                              )}
                            </p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={handleForgotPassword}
                            disabled={isProcessingForgot}
                            className="text-blue-600 dark:text-blue-400 text-sm font-bold hover:underline"
                          >
                            {t.forgotPasswordModal.notReceived}
                          </button>
                        )}
                      </div>
                    </div>
                    <Magnetic>
                      <button
                        type="button"
                        onClick={() => setForgotStatus({ type: 'idle' })}
                        className="w-full py-4 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-350 text-sm font-bold transition-colors"
                      >
                        {T.forgotModal.back}
                      </button>
                    </Magnetic>
                  </form>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-6">
                    <div className="flex p-1.5 bg-slate-100 dark:bg-slate-700 rounded-2xl border border-slate-200 dark:border-slate-600">
                      {(['phone', 'zalo', 'request'] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setResetMethod(method)}
                          className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                            resetMethod === method
                              ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {method === 'phone'
                            ? t.forgotPasswordModal.phoneNumber
                            : method === 'zalo'
                              ? 'Zalo'
                              : t.forgotPasswordModal.submitRequest}
                        </button>
                      ))}
                    </div>
                    <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-2xl border border-blue-100/50 dark:border-blue-500/20">
                      <p className="text-xs text-blue-700/80 dark:text-blue-400/90 leading-relaxed font-semibold">
                        {resetMethod === 'phone'
                          ? t.forgotPasswordModal.smsDescription
                          : resetMethod === 'zalo'
                            ? t.forgotPasswordModal.zaloDescription
                            : t.forgotPasswordModal.teacherApprovalDescription}
                      </p>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] ml-1">
                          {t.forgotPasswordModal.accountCode}
                        </label>
                        <input
                          type="text"
                          value={forgotId}
                          onChange={(e) => setForgotId(e.target.value.toUpperCase())}
                          placeholder="HO123-45"
                          className="w-full px-4 py-4 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono text-center text-xl tracking-widest placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-300 dark:text-slate-100"
                          required
                        />
                      </div>
                      {(resetMethod === 'phone' ||
                        resetMethod === 'zalo' ||
                        resetMethod === 'request') && (
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] ml-1">
                            {t.forgotPasswordModal.phoneNumber}
                          </label>
                          <div className="relative group">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
                            <input
                              type="tel"
                              value={forgotPhone}
                              onChange={(e) => setForgotPhone(e.target.value)}
                              placeholder="09xx xxx xxx"
                              className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-slate-100"
                              required
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <Magnetic>
                      <button
                        type="submit"
                        disabled={isProcessingForgot}
                        className="w-full flex items-center justify-center space-x-3 bg-blue-600 text-white py-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-xl active:scale-[0.98] disabled:opacity-50"
                      >
                        {isProcessingForgot ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Send className="w-5 h-5" />
                        )}
                        <span>
                          {isProcessingForgot
                            ? t.forgotPasswordModal.sending
                            : resetMethod === 'phone'
                              ? t.forgotPasswordModal.sendOTP
                              : resetMethod === 'zalo'
                                ? t.forgotPasswordModal.sendOTPZalo
                                : t.forgotPasswordModal.sendRequest}
                        </span>
                      </button>
                    </Magnetic>
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
