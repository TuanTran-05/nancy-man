import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, CheckCircle2, AlertCircle, Send, Phone, ShieldCheck, Lock } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';
import { useLanguage } from '../../lib/i18n/useLanguage';

interface Props {
  isOpen: boolean;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  method: 'zalo' | 'request';
  setMethod: (v: 'zalo' | 'request') => void;
  otp: string;
  setOtp: (v: string) => void;
  newPassword: string;
  setNewPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  status: {
    type: 'idle' | 'loading' | 'otp_sent' | 'otp_verified' | 'success' | 'error';
    message?: string;
  };
  error: string | null;
  success: boolean;
  isProcessing: boolean;
  language: string;
  resendTimer: number;
  onSubmit: (e: React.FormEvent) => void;
  onVerifyOtp: (e: React.FormEvent) => void;
  onResetPassword: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function StaffForgotPasswordModal({
  isOpen,
  email,
  setEmail,
  phone,
  setPhone,
  method,
  setMethod,
  otp,
  setOtp,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  status,
  error,
  success,
  isProcessing,
  language: _language,
  resendTimer,
  onSubmit,
  onVerifyOtp,
  onResetPassword,
  onClose,
}: Props) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-blue-500 to-blue-600">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <KeyRound className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {t.staffForgotPasswordModal.forgotPassword}
                    </h3>
                    <p className="text-sm text-blue-100">{t.staffForgotPasswordModal.title}</p>
                  </div>
                </div>
              </div>

              {success && status.type === 'success' ? (
                <div className="p-6 text-center">
                  <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                    {method === 'zalo'
                      ? t.staffForgotPasswordModal.passwordChangedTitle
                      : t.staffForgotPasswordModal.requestSent}
                  </h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                    {status.message || t.staffForgotPasswordModal.successMessage}
                  </p>
                  <button
                    onClick={onClose}
                    className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors"
                  >
                    {t.staffForgotPasswordModal.gotIt}
                  </button>
                </div>
              ) : status.type === 'otp_verified' ? (
                <form onSubmit={onResetPassword} className="p-6 space-y-4">
                  <div className="rounded-xl border border-emerald-100 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-500/10 p-3 flex gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                      {t.staffForgotPasswordModal.otpVerified}
                    </p>
                  </div>
                  <div>
                    <label
                      htmlFor="new-password"
                      className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {t.staffForgotPasswordModal.newPassword}
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        id="new-password"
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium text-slate-700 dark:text-slate-200 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {t.staffForgotPasswordModal.confirmPassword}
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        id="confirm-password"
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium text-slate-700 dark:text-slate-200 outline-none"
                      />
                    </div>
                  </div>
                  {error && (
                    <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-800 rounded-xl p-3 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isProcessing || !newPassword || !confirmPassword}
                    className="w-full px-4 py-3 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      t.staffForgotPasswordModal.resetPassword
                    )}
                  </button>
                </form>
              ) : status.type === 'otp_sent' ? (
                <form onSubmit={onVerifyOtp} className="p-6 space-y-4">
                  <div className="rounded-xl border border-blue-100 dark:border-blue-800 bg-blue-50 dark:bg-blue-500/10 p-3">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      {status.message || t.staffForgotPasswordModal.otpSentGeneric}
                    </p>
                  </div>
                  <div>
                    <label
                      htmlFor="otp-code"
                      className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {t.staffForgotPasswordModal.otpLabel}
                    </label>
                    <input
                      id="otp-code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium text-slate-700 dark:text-slate-200 outline-none text-center tracking-[0.4em]"
                    />
                  </div>
                  {error && (
                    <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-800 rounded-xl p-3 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isProcessing || otp.length !== 6}
                    className="w-full px-4 py-3 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      t.staffForgotPasswordModal.verifyOtp
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onSubmit}
                    disabled={isProcessing || resendTimer > 0}
                    className="w-full text-sm font-semibold text-blue-600 dark:text-blue-400 disabled:text-slate-400"
                  >
                    {resendTimer > 0
                      ? t.staffForgotPasswordModal.resendAfter.replace(
                          '{seconds}',
                          String(resendTimer)
                        )
                      : t.staffForgotPasswordModal.resendOtp}
                  </button>
                </form>
              ) : (
                <form onSubmit={onSubmit} className="p-6 space-y-4">
                  <div className="flex rounded-xl bg-slate-100 dark:bg-slate-700 p-1">
                    <button
                      type="button"
                      onClick={() => setMethod('zalo')}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        method === 'zalo'
                          ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm'
                          : 'text-slate-500 dark:text-slate-300'
                      }`}
                    >
                      {t.staffForgotPasswordModal.resetWithZalo}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMethod('request')}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        method === 'request'
                          ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm'
                          : 'text-slate-500 dark:text-slate-300'
                      }`}
                    >
                      {t.staffForgotPasswordModal.requestAdmin}
                    </button>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {method === 'zalo'
                      ? t.staffForgotPasswordModal.zaloDescription
                      : t.staffForgotPasswordModal.adminDescription}
                  </p>
                  <div>
                    <label
                      htmlFor="login-email"
                      className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {t.staffForgotPasswordModal.loginEmail}
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tuan.admin@nancy.com"
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium text-slate-700 dark:text-slate-200 outline-none"
                    />
                  </div>
                  {method === 'zalo' && (
                    <div>
                      <label
                        htmlFor="zalo-phone"
                        className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        {t.staffForgotPasswordModal.phoneNumber}
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          id="zalo-phone"
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="09xx xxx xxx"
                          className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium text-slate-700 dark:text-slate-200 outline-none"
                        />
                      </div>
                    </div>
                  )}
                  {error && (
                    <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-800 rounded-xl p-3 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 px-4 py-3 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={
                        isProcessing || !email.trim() || (method === 'zalo' && !phone.trim())
                      }
                      className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isProcessing ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          {method === 'zalo'
                            ? t.staffForgotPasswordModal.sendOtp
                            : t.staffForgotPasswordModal.sendRequest}
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
