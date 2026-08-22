import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Lock,
  Mail,
  User,
  Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLoginHandlers } from '../../hooks/useLoginHandlers';
import { StaffForgotPasswordModal } from '../../components/auth/StaffForgotPasswordModal';
import { ForgotPasswordModal } from '../../components/auth/ForgotPasswordModal';
import { TurnstileWidget } from '../../components/auth/TurnstileWidget';
import { CENTER_LOGO_URL } from '../../lib/brand';
import { translations } from '../../lib/i18n/translations';

const roleTabs: Array<{
  id: 'staff' | 'student' | 'parent';
  icon: LucideIcon;
  labelKey: 'roleStaff' | 'roleStudent' | 'roleParent';
}> = [
  { id: 'staff', icon: User, labelKey: 'roleStaff' },
  { id: 'student', icon: Users, labelKey: 'roleStudent' },
  { id: 'parent', icon: Users, labelKey: 'roleParent' },
];

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.3l-6.3-5.3C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.5 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.1-4.1 5.4l6.3 5.3C36.9 39.3 44 34 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

export default function Login() {
  const {
    language,
    T,
    loginType,
    setLoginType,
    error,
    isLoggingIn,
    staffEmail,
    setStaffEmail,
    staffPassword,
    setStaffPassword,
    studentCode,
    setStudentCode,
    studentPassword,
    setStudentPassword,
    showForgotModal,
    setShowForgotModal,
    forgotId,
    setForgotId,
    forgotPhone,
    setForgotPhone,
    resetMethod,
    setResetMethod,
    otpCode,
    setOtpCode,
    newPassword,
    setNewPassword,
    confirmNewPassword,
    setConfirmNewPassword,
    forgotStatus,
    setForgotStatus,
    isProcessingForgot,
    showStaffForgotModal,
    setShowStaffForgotModal,
    staffForgotEmail,
    setStaffForgotEmail,
    staffForgotPhone,
    setStaffForgotPhone,
    staffForgotMethod,
    setStaffForgotMethod,
    staffForgotOtp,
    setStaffForgotOtp,
    staffForgotNewPassword,
    setStaffForgotNewPassword,
    staffForgotConfirmPassword,
    setStaffForgotConfirmPassword,
    setStaffForgotResetToken,
    staffForgotError,
    setStaffForgotError,
    staffForgotSuccess,
    setStaffForgotSuccess,
    staffForgotStatus,
    setStaffForgotStatus,
    isProcessingStaffForgot,
    resendTimer,
    handleStaffLogin,
    handleGoogleLogin,
    handleCodeLogin,
    handleForgotPassword,
    handleVerifyOtp,
    handleStaffForgotPassword,
    handleVerifyStaffForgotOtp,
    handleResetStaffForgotPassword,
    handleResetPassword,
    lockoutUntil,
    turnstileSiteKey,
    setTurnstileToken,
    turnstileWidgetRef,
    isTurnstileReady,
  } = useLoginHandlers();

  const lp = translations[language].loginPage;
  const authErrors = translations[language].authErrors;

  const [lockoutCountdown, setLockoutCountdown] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!lockoutUntil) {
      setLockoutCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      setLockoutCountdown(remaining > 0 ? remaining : null);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const forgotPasswordLabel = lp.forgotPassword;
  const submitLabel = lp.signIn;
  const isStaffLogin = loginType === 'staff';
  const codeLabel = loginType === 'student' ? lp.studentCode : lp.parentCode;
  const codePlaceholder =
    loginType === 'student' ? lp.codePlaceholderStudent : lp.codePlaceholderParent;

  const openForgotPassword = () => {
    setResetMethod('request');

    if (loginType === 'staff') {
      setShowStaffForgotModal(true);
      return;
    }

    setForgotId(studentCode);
    setShowForgotModal(true);
  };

  return (
    <div className="login-redesign min-h-screen overflow-hidden">
      <div className="login-liquid login-liquid-left" aria-hidden="true" />
      <div className="login-liquid login-liquid-right" aria-hidden="true" />
      <div className="login-ribbon login-ribbon-orange" aria-hidden="true" />
      <div className="login-ribbon login-ribbon-blue" aria-hidden="true" />
      <div className="login-bubble login-bubble-a" aria-hidden="true" />
      <div className="login-bubble login-bubble-b" aria-hidden="true" />
      <div className="login-bubble login-bubble-c" aria-hidden="true" />
      <div className="login-bubble login-bubble-d" aria-hidden="true" />

      <img
        src={CENTER_LOGO_URL}
        alt="Thiên Uy English Center"
        className="login-brand-logo login-corner-logo"
        referrerPolicy="no-referrer"
      />

      <main className="relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-16 sm:px-8 lg:px-12">
        <section className="flex w-full items-center justify-center py-2 lg:py-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.08 }}
            className="login-glass-card w-full max-w-[660px] px-5 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12"
          >
            <header className="mb-8 text-center">
              <h2 className="text-3xl font-extrabold leading-tight tracking-normal text-slate-900 sm:text-[2.05rem]">
                {lp.welcomeBack}
              </h2>
              <p className="mt-3 text-base font-semibold text-slate-500">{lp.subtitle}</p>
            </header>

            <div className="login-role-tabs mb-7 grid grid-cols-3 gap-1.5 rounded-[1.35rem] p-1.5">
              {roleTabs.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = loginType === tab.id;

                return (
                  <button
                    key={tab.id}
                    data-testid={`login-role-${tab.id}`}
                    type="button"
                    onClick={() => setLoginType(tab.id)}
                    className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl px-1.5 text-[10px] font-extrabold transition-all sm:flex-row sm:gap-2 sm:px-2 sm:text-sm ${
                      isActive
                        ? 'bg-white/85 text-orange-500 shadow-[0_12px_28px_rgba(15,23,42,0.08)]'
                        : 'text-slate-500 hover:bg-white/35 hover:text-slate-700'
                    }`}
                  >
                    <TabIcon className="h-4 w-4 shrink-0" />
                    <span className="leading-tight">{lp[tab.labelKey]}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-6">
              <AnimatePresence mode="wait">
                {isStaffLogin ? (
                  <motion.div
                    key="staff"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <form onSubmit={handleStaffLogin} className="space-y-5">
                      <div className="login-input-shell">
                        <label htmlFor="staff-email" className="login-input-label">
                          <Mail className="h-5 w-5 text-blue-500" />
                          <span>{lp.email}</span>
                        </label>
                        <input
                          id="staff-email"
                          type="email"
                          required
                          value={staffEmail}
                          onChange={(event) => setStaffEmail(event.target.value)}
                          placeholder="tuan.admin@nancy.com"
                          className="login-input"
                          autoComplete="email"
                        />
                      </div>

                      <div className="login-input-shell">
                        <label htmlFor="staff-password" className="login-input-label">
                          <Lock className="h-5 w-5 text-blue-500" />
                          <span>{lp.password}</span>
                        </label>
                        <input
                          id="staff-password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={staffPassword}
                          onChange={(event) => setStaffPassword(event.target.value)}
                          placeholder={lp.enterPassword}
                          className="login-input pr-11"
                          autoComplete="current-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="login-password-toggle"
                          aria-label={showPassword ? lp.hidePassword : lp.showPassword}
                        >
                          {showPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-extrabold uppercase tracking-normal text-slate-500">
                          {lp.botVerification}
                        </p>
                        {turnstileSiteKey ? (
                          <TurnstileWidget
                            ref={turnstileWidgetRef}
                            siteKey={turnstileSiteKey}
                            action="login"
                            onVerify={setTurnstileToken}
                            onExpire={() => setTurnstileToken('')}
                            onError={() => setTurnstileToken('')}
                          />
                        ) : (
                          <div
                            role="alert"
                            className="rounded-2xl border border-red-200/80 bg-red-50/85 p-4 text-sm font-semibold leading-relaxed text-red-700"
                          >
                            {authErrors.turnstileConfigMissing}
                          </div>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={isLoggingIn || !isTurnstileReady}
                        className="login-primary-button mt-2 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-lg font-extrabold text-white shadow-[0_20px_40px_rgba(37,99,235,0.22)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_46px_rgba(37,99,235,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isLoggingIn ? (
                          <span className="h-5 w-5 rounded-full border-2 border-white/35 border-t-white animate-spin" />
                        ) : (
                          <>
                            <span>{submitLabel}</span>
                            <ArrowRight className="h-5 w-5" />
                          </>
                        )}
                      </button>
                    </form>

                    <button
                      type="button"
                      onClick={openForgotPassword}
                      className="mx-auto block text-sm font-extrabold text-blue-600 transition-colors hover:text-blue-700"
                    >
                      {forgotPasswordLabel}
                    </button>

                    <div className="relative flex items-center justify-center">
                      <div className="h-px flex-1 bg-white/65" />
                      <span className="px-4 text-sm font-semibold text-slate-500">{lp.or}</span>
                      <div className="h-px flex-1 bg-white/65" />
                    </div>

                    <button
                      onClick={handleGoogleLogin}
                      disabled={isLoggingIn || !isTurnstileReady}
                      type="button"
                      className="login-google-button flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-extrabold text-slate-600 transition-all hover:bg-white/55 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg"
                    >
                      {isLoggingIn ? (
                        <span className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" />
                      ) : (
                        <GoogleMark />
                      )}
                      <span>{isLoggingIn ? lp.connecting : lp.continueWithGoogle}</span>
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="student-parent"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <form onSubmit={handleCodeLogin} className="space-y-5">
                      <div className="login-input-shell">
                        <label htmlFor="student-code" className="login-input-label">
                          <Key className="h-5 w-5 text-blue-500" />
                          <span>{codeLabel}</span>
                        </label>
                        <input
                          id="student-code"
                          type="text"
                          value={studentCode}
                          onChange={(event) => setStudentCode(event.target.value.toUpperCase())}
                          placeholder={codePlaceholder}
                          className="login-input font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal"
                          required
                          autoComplete="username"
                        />
                      </div>

                      <div className="login-input-shell">
                        <label htmlFor="student-password" className="login-input-label">
                          <Lock className="h-5 w-5 text-blue-500" />
                          <span>{lp.password}</span>
                        </label>
                        <input
                          id="student-password"
                          type={showPassword ? 'text' : 'password'}
                          value={studentPassword}
                          onChange={(event) => setStudentPassword(event.target.value)}
                          placeholder={lp.enterPassword}
                          className="login-input pr-11"
                          required
                          autoComplete="current-password"
                          maxLength={72}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="login-password-toggle"
                          aria-label={showPassword ? lp.hidePassword : lp.showPassword}
                        >
                          {showPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-extrabold uppercase tracking-normal text-slate-500">
                          {lp.botVerification}
                        </p>
                        {turnstileSiteKey ? (
                          <TurnstileWidget
                            ref={turnstileWidgetRef}
                            siteKey={turnstileSiteKey}
                            action="login"
                            onVerify={setTurnstileToken}
                            onExpire={() => setTurnstileToken('')}
                            onError={() => setTurnstileToken('')}
                          />
                        ) : (
                          <div
                            role="alert"
                            className="rounded-2xl border border-red-200/80 bg-red-50/85 p-4 text-sm font-semibold leading-relaxed text-red-700"
                          >
                            {authErrors.turnstileConfigMissing}
                          </div>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={
                          isLoggingIn ||
                          !studentCode.trim() ||
                          !studentPassword.trim() ||
                          !isTurnstileReady
                        }
                        className="login-primary-button mt-2 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-lg font-extrabold text-white shadow-[0_20px_40px_rgba(37,99,235,0.22)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_46px_rgba(37,99,235,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isLoggingIn ? (
                          <span className="h-5 w-5 rounded-full border-2 border-white/35 border-t-white animate-spin" />
                        ) : (
                          <>
                            <span>{submitLabel}</span>
                            <ArrowRight className="h-5 w-5" />
                          </>
                        )}
                      </button>
                    </form>

                    <button
                      type="button"
                      onClick={openForgotPassword}
                      className="mx-auto block text-sm font-extrabold text-blue-600 transition-colors hover:text-blue-700"
                    >
                      {forgotPasswordLabel}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {lockoutCountdown !== null || error ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="rounded-2xl border border-red-200/80 bg-red-50/85 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold leading-relaxed text-red-700">
                          {lockoutCountdown !== null
                            ? lp.accountLocked.replace('{seconds}', String(lockoutCountdown))
                            : error}
                        </p>
                        {isStaffLogin && (
                          <button
                            type="button"
                            onClick={() => window.open(window.location.href, '_blank')}
                            className="mt-2 flex items-center gap-1 text-xs font-extrabold text-red-600 underline transition-colors hover:text-red-800"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {lp.tryNewTab}
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <footer className="mt-9 text-center text-xs font-extrabold tracking-wide text-slate-400">
              copyright@tuantran_05
            </footer>
          </motion.div>
        </section>
      </main>

      <ForgotPasswordModal
        show={showForgotModal}
        onClose={() => {
          setShowForgotModal(false);
          setForgotStatus({ type: 'idle' });
        }}
        T={T}
        language={language}
        forgotStatus={forgotStatus}
        setForgotStatus={setForgotStatus}
        resetMethod={resetMethod}
        setResetMethod={setResetMethod}
        forgotId={forgotId}
        setForgotId={setForgotId}
        forgotPhone={forgotPhone}
        setForgotPhone={setForgotPhone}
        otpCode={otpCode}
        setOtpCode={setOtpCode}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        confirmNewPassword={confirmNewPassword}
        setConfirmNewPassword={setConfirmNewPassword}
        isProcessingForgot={isProcessingForgot}
        handleForgotPassword={handleForgotPassword}
        handleVerifyOtp={handleVerifyOtp}
        handleResetPassword={handleResetPassword}
        resendTimer={resendTimer}
      />

      <StaffForgotPasswordModal
        isOpen={showStaffForgotModal}
        email={staffForgotEmail}
        setEmail={setStaffForgotEmail}
        phone={staffForgotPhone}
        setPhone={setStaffForgotPhone}
        method={staffForgotMethod}
        setMethod={setStaffForgotMethod}
        otp={staffForgotOtp}
        setOtp={setStaffForgotOtp}
        newPassword={staffForgotNewPassword}
        setNewPassword={setStaffForgotNewPassword}
        confirmPassword={staffForgotConfirmPassword}
        setConfirmPassword={setStaffForgotConfirmPassword}
        status={staffForgotStatus}
        error={staffForgotError}
        success={staffForgotSuccess}
        isProcessing={isProcessingStaffForgot}
        language={language}
        resendTimer={resendTimer}
        onSubmit={handleStaffForgotPassword}
        onVerifyOtp={handleVerifyStaffForgotOtp}
        onResetPassword={handleResetStaffForgotPassword}
        onClose={() => {
          setShowStaffForgotModal(false);
          setStaffForgotError(null);
          setStaffForgotSuccess(false);
          setStaffForgotEmail('');
          setStaffForgotPhone('');
          setStaffForgotOtp('');
          setStaffForgotResetToken(null);
          setStaffForgotNewPassword('');
          setStaffForgotConfirmPassword('');
          setStaffForgotStatus({ type: 'idle' });
        }}
      />
    </div>
  );
}
