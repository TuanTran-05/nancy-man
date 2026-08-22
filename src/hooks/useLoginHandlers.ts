import { useState, useEffect, useRef } from 'react';
import { auth } from '../lib/auth/sessionAuth';
import { validatePasswordStrength } from '../lib/auth/passwordValidation';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../lib/i18n/useLanguage';
import { apiRequest } from '../lib/api/apiClient';
import { localize } from '../lib/i18n/localize';

type StaffDenyReason = 'revoked' | 'not_allowed';

type StaffForgotMethod = 'zalo' | 'request';
type StaffForgotStatusType = 'idle' | 'loading' | 'otp_sent' | 'otp_verified' | 'success' | 'error';

type StaffForgotStatus = {
  type: StaffForgotStatusType;
  message?: string;
};

type SmsConfirmation = { challengeId: string };

export const getStaffDenyReason = (err: unknown): StaffDenyReason | null => {
  const status = (err as { status?: unknown })?.status;
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === 'object') {
    const reason = (data as { reason?: unknown; blockedReason?: unknown }).reason;
    if (reason === 'revoked' || reason === 'not_allowed') return reason;

    const blockedReason = (data as { blockedReason?: unknown }).blockedReason;
    if (blockedReason === 'revoked' || blockedReason === 'not_allowed') return blockedReason;

    const error = (data as { error?: unknown }).error;
    if (status === 403 && typeof error === 'string') {
      const normalized = error.toLowerCase();
      if (normalized.includes('revoked')) return 'revoked';
      if (normalized.includes('not allowed')) return 'not_allowed';
    }
  }
  return null;
};

export function useLoginHandlers() {
  const { language, t } = useLanguage();
  const T = t.auth;
  const { setBlockedInfo } = useAuth();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginType, setLoginTypeState] = useState<'staff' | 'student' | 'parent'>('staff');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [studentPassword, setStudentPassword] = useState('');

  // Forgot Password state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotPhone, setForgotPhone] = useState('');
  const [resetMethod, setResetMethod] = useState<'phone' | 'zalo' | 'request'>('phone');
  const [zaloResetToken, setZaloResetToken] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [isProcessingForgot, setIsProcessingForgot] = useState(false);
  const [forgotStatus, setForgotStatus] = useState<{
    type: 'idle' | 'loading' | 'otp_sent' | 'otp_verified' | 'success' | 'error';
    message?: string;
  }>({ type: 'idle' });
  const [confirmationResult, setConfirmationResult] = useState<SmsConfirmation | null>(null);
  const [targetStudentDocId, setTargetStudentDocId] = useState<string | null>(null);
  const [targetStudentData, setTargetStudentData] = useState<any>(null);
  const [resetType, setResetType] = useState<'student' | 'parent'>('student');
  const [resetLookupToken, setResetLookupToken] = useState<string | null>(null);

  // Staff forgot password state
  const [showStaffForgotModal, setShowStaffForgotModal] = useState(false);
  const [staffForgotEmail, setStaffForgotEmail] = useState('');
  const [staffForgotPhone, setStaffForgotPhone] = useState('');
  const [staffForgotMethod, setStaffForgotMethod] = useState<StaffForgotMethod>('zalo');
  const [staffForgotOtp, setStaffForgotOtp] = useState('');
  const [staffForgotResetToken, setStaffForgotResetToken] = useState<string | null>(null);
  const [staffForgotNewPassword, setStaffForgotNewPassword] = useState('');
  const [staffForgotConfirmPassword, setStaffForgotConfirmPassword] = useState('');
  const [staffForgotError, setStaffForgotError] = useState<string | null>(null);
  const [staffForgotSuccess, setStaffForgotSuccess] = useState(false);
  const [staffForgotStatus, setStaffForgotStatus] = useState<StaffForgotStatus>({ type: 'idle' });
  const [isProcessingStaffForgot, setIsProcessingStaffForgot] = useState(false);

  const [resendTimer, setResendTimer] = useState(0);

  // Login rate limiting
  const [loginAttempts, setLoginAttempts] = useState(() => {
    try {
      const stored = localStorage.getItem('login_attempts');
      if (stored) {
        const data = JSON.parse(stored);
        if (data.resetAt && Date.now() < data.resetAt) return data.count;
        localStorage.removeItem('login_attempts');
      }
    } catch {
      /* localStorage unavailable */
    }
    return 0;
  });
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem('login_lockout');
      if (stored) {
        const until = parseInt(stored, 10);
        if (Date.now() < until) return until;
        localStorage.removeItem('login_lockout');
      }
    } catch {
      /* localStorage unavailable */
    }
    return null;
  });

  const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileWidgetRef = useRef<{ reset: () => void } | null>(null);

  const setLoginType = (type: 'staff' | 'student' | 'parent') => {
    setLoginTypeState(type);
    setTurnstileToken('');
    turnstileWidgetRef.current?.reset();
  };

  // ---------------------------------------------------------------------------
  // Rate limit helper
  // ---------------------------------------------------------------------------

  const recordFailedLoginAttempt = () => {
    const newAttempts = loginAttempts + 1;
    setLoginAttempts(newAttempts);
    const resetAt = Date.now() + 5 * 60 * 1000;
    localStorage.setItem('login_attempts', JSON.stringify({ count: newAttempts, resetAt }));
    if (newAttempts >= 5) {
      const lockUntil = Date.now() + 5 * 60 * 1000;
      setLockoutUntil(lockUntil);
      localStorage.setItem('login_lockout', lockUntil.toString());
    }
  };

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('authError');
    if (authError !== 'not_allowed' && authError !== 'revoked') return;

    params.delete('authError');
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    );
    setBlockedInfo({ email: '', reason: authError });
  }, [setBlockedInfo]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendTimer > 0) {
      timer = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendTimer]);

  useEffect(() => {
    const checkExistingAuth = async () => {
      try {
        const user = auth.currentUser;
        if (user && loginType === 'staff') {
          if (!user.email) return;

          return;
        }
      } catch (err) {
        const reason = getStaffDenyReason(err);
        if (reason && auth.currentUser?.email) {
          setBlockedInfo({ email: auth.currentUser.email, reason });
          // Don't sign out here — let BlockedModal handle the sign-out
          // to avoid race conditions that clear state before the modal renders
          return;
        }
        console.error('Error in checkExistingAuth:', err);
      }
    };

    checkExistingAuth();
  }, [loginType, setBlockedInfo]);

  // ---------------------------------------------------------------------------
  // Handler functions
  // ---------------------------------------------------------------------------

  const getTurnstileRequiredMessage = () => t.authErrors.turnstileRequired;
  const getTurnstileConfigMessage = () => t.authErrors.turnstileConfigMissing;

  const resetTurnstile = () => {
    setTurnstileToken('');
    turnstileWidgetRef.current?.reset();
  };

  const requireTurnstileToken = () => {
    if (!turnstileSiteKey) {
      setError(getTurnstileConfigMessage());
      return false;
    }
    if (!turnstileToken) {
      setError(getTurnstileRequiredMessage());
      return false;
    }
    return true;
  };

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn || !staffEmail.trim() || !staffPassword.trim()) return;

    // Rate limit check
    if (lockoutUntil && Date.now() < lockoutUntil) {
      return;
    }

    if (!requireTurnstileToken()) return;

    setError(null);
    setIsLoggingIn(true);
    try {
      const response = await fetch('/api/v1/auth/session-login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          loginType: 'staff',
          email: staffEmail.trim().toLowerCase(),
          password: staffPassword,
          turnstileToken,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw Object.assign(new Error(data.error || 'Session login failed'), {
          status: response.status,
          data,
        });
      }
      const sessionUser = await auth.refresh();
      if (!sessionUser) throw new Error('Session was not established');
    } catch (err: any) {
      console.error('Staff login failed:', err);
      const reason = getStaffDenyReason(err);
      if (reason) {
        setBlockedInfo({ email: auth.currentUser?.email || staffEmail.trim(), reason });
        // Don't sign out here — let BlockedModal handle the sign-out
        // to avoid race conditions that clear state before the modal renders
        return;
      }
      recordFailedLoginAttempt();
      setError(
        localize(
          language,
          'Đăng nhập thất bại. Vui lòng kiểm tra lại email/mật khẩu.',
          'Login failed. Please check your email/password.'
        )
      );
      await auth.signOut();
    } finally {
      resetTurnstile();
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (isLoggingIn) return;
    if (!requireTurnstileToken()) return;
    setError(null);
    setIsLoggingIn(true);

    try {
      const response = await fetch('/api/v1/auth/google-start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ turnstileToken, returnTo: window.location.pathname }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.authorizationUrl !== 'string') {
        throw Object.assign(new Error(data.error || 'Unable to start Google login'), {
          status: response.status,
          data,
        });
      }
      window.location.assign(data.authorizationUrl);
    } catch (err: any) {
      console.error('Login failed:', err);
      const reason = getStaffDenyReason(err);
      if (reason) {
        setBlockedInfo({ email: auth.currentUser?.email || '', reason });
        // Don't sign out here — let BlockedModal handle the sign-out
        // to avoid race conditions that clear state before the modal renders
        return;
      }
      if (
        err.code === 'auth/popup-closed-by-user' ||
        err.code === 'auth/popup-blocked' ||
        err.code === 'auth/cancelled-popup-request'
      ) {
        setError(
          localize(
            language,
            '⚠️ Đăng nhập Google bị chặn bởi trình duyệt.\n\nCách fix: Vào chrome://settings/cookies → "Sites allowed to use third-party cookies" → Thêm "your application domain" → Thử lại.',
            '⚠️ Google login blocked by browser.\n\nFix: Go to chrome://settings/cookies → "Sites allowed to use third-party cookies" → Add "your application domain" → Try again.'
          )
        );
      } else {
        setError(
          localize(
            language,
            'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.',
            'An unexpected error occurred. Please try again.'
          )
        );
      }
    } finally {
      resetTurnstile();
      setIsLoggingIn(false);
    }
  };

  const STUDENT_LOGIN_FAIL_MSG = t.authErrors.studentLoginFail;

  const handleCodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentCode.trim() || !studentPassword.trim() || isLoggingIn) return;

    // Rate limit check
    if (lockoutUntil && Date.now() < lockoutUntil) {
      return;
    }

    if (!requireTurnstileToken()) return;

    setError(null);
    setIsLoggingIn(true);

    try {
      let queryCode = studentCode.trim().toUpperCase();
      if (loginType === 'parent') {
        if (!queryCode.startsWith('PH')) {
          setError(
            localize(
              language,
              'Mã phụ huynh phải bắt đầu bằng "PH" (ví dụ: PHG8-01).',
              'Parent ID must start with "PH" (e.g. PHG8-01).'
            )
          );
          setIsLoggingIn(false);
          return;
        }
        queryCode = queryCode.substring(2); // Remove "PH"
      }

      // 1. Call server-side verification API (password hash/salt NEVER leaves server)
      let apiRes: Response;
      try {
        apiRes = await fetch('/api/v1/auth/verify-student-login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            studentCode: queryCode,
            password: studentPassword.trim(),
            loginType,
            turnstileToken,
          }),
        });
      } catch (fetchErr: any) {
        console.error('Verify API network error:', fetchErr);
        setError(
          localize(
            language,
            'Không thể kết nối đến máy chủ. Vui lòng thử lại.',
            'Cannot connect to server. Please try again.'
          )
        );
        setIsLoggingIn(false);
        return;
      }

      const apiData = await apiRes.json();

      if (!apiRes.ok || !apiData.success) {
        if (apiRes.status === 429) {
          const lockUntil = Date.now() + 5 * 60 * 1000;
          setLockoutUntil(lockUntil);
          localStorage.setItem('login_lockout', lockUntil.toString());
          setError(
            localize(
              language,
              'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút.',
              'Too many failed attempts. Please try again in 5 minutes.'
            )
          );
        } else if (apiRes.status === 403 && apiData.code === 'PASSWORD_NOT_SET') {
          setError(
            localize(
              language,
              'Tài khoản chưa đặt mật khẩu. Vui lòng nhấn "Quên mật khẩu" để tạo mật khẩu mới.',
              'No password set. Please use "Forgot password" to create one.'
            )
          );
        } else if (apiRes.status === 403 && apiData.blockedReason) {
          setBlockedInfo({
            email: apiData.studentName || 'Học sinh',
            reason: apiData.blockedReason,
          });
        } else if (apiRes.status === 401) {
          recordFailedLoginAttempt();
          setError(STUDENT_LOGIN_FAIL_MSG);
        } else {
          setError(
            apiData.error ||
              localize(language, 'Đã xảy ra lỗi khi đăng nhập.', 'Login error occurred.')
          );
        }
        setIsLoggingIn(false);
        return;
      }

      // 2. Server verified — sign in with deterministic Custom Token (stable UID per role/student)
      localStorage.removeItem('edu_user_displayName');
      localStorage.removeItem('edu_student_session');
      let authResult;
      try {
        authResult = await auth.refresh();
        if (!authResult) throw new Error('Session was not established');
      } catch (authErr: any) {
        console.error('Custom token auth failed:', authErr);
        setError(localize(language, 'Lỗi xác thực: ', 'Auth error: ') + authErr.message);
        setIsLoggingIn(false);
        return;
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(
        localize(
          language,
          'Đã xảy ra lỗi khi đăng nhập. Vui lòng thử lại. Chi tiết: ',
          'Registration failed. Please try again. Details: '
        ) + err.message
      );
      await auth.signOut();
    } finally {
      resetTurnstile();
      setIsLoggingIn(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotId.trim() || isProcessingForgot) return;
    if (
      (resetMethod === 'phone' || resetMethod === 'zalo' || resetMethod === 'request') &&
      !forgotPhone.trim()
    )
      return;

    setIsProcessingForgot(true);
    setForgotStatus({ type: 'loading' });
    setForgotError(null);

    try {
      let queryId = forgotId.trim().toUpperCase();
      let type: 'student' | 'parent' = 'student';

      if (queryId.startsWith('PH')) {
        type = 'parent';
        queryId = queryId.substring(2);
      }

      setResetType(type);
      const normalizedId = type === 'parent' ? 'PH' + queryId : queryId;

      // Zalo flow: skip client-side PostgreSQL API query — server API handles all validation
      if (resetMethod === 'zalo') {
        setResetType(type);

        try {
          const response = await fetch('/api/v1/auth/request-zalo-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studentCode: queryId,
              phone: forgotPhone.trim(),
              loginType: type,
            }),
          });
          const text = await response.text();
          let data: any;
          try {
            data = JSON.parse(text);
          } catch {
            data = {};
          }
          if (!response.ok || !data.success) {
            throw new Error(
              data.error || t.authErrors.serverError.replace('{status}', String(response.status))
            );
          }

          setResendTimer(60);
          setForgotStatus({
            type: 'otp_sent',
            message: t.authErrors.zaloOtpSent.replace('{phone}', forgotPhone),
          });
        } catch (zaloErr: any) {
          console.error('Zalo OTP request failed:', zaloErr);
          throw zaloErr;
        }
        setIsProcessingForgot(false);
        return;
      }

      // Phone and Request flows: lookup student via backend API (no client PostgreSQL API access)
      // Server validates phone match, account status, and pending requests
      let lookupResult: any;
      try {
        const lookupRes = await fetch('/api/v1/auth/lookup-student', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentCode: queryId,
            phone: forgotPhone.trim(),
            loginType: type,
          }),
        });
        lookupResult = await lookupRes.json();

        // All failures return generic error to prevent enumeration
        if (!lookupRes.ok || !lookupResult.success) {
          if (lookupResult.pending) {
            setForgotStatus({
              type: 'error',
              message: t.auth.forgotModal.pendingMessage,
            });
          } else {
            setForgotStatus({
              type: 'error',
              message: t.authErrors.studentNotFound,
            });
          }
          setIsProcessingForgot(false);
          return;
        }

        if (lookupResult.pending) {
          setForgotStatus({
            type: 'error',
            message: t.auth.forgotModal.pendingMessage,
          });
          setIsProcessingForgot(false);
          return;
        }
      } catch (lookupErr: any) {
        console.error('Student lookup failed:', lookupErr);
        throw lookupErr;
      }

      const studentData = lookupResult.student;
      const studentDocId = studentData.id;
      const lookupToken = lookupResult.lookupToken;

      if (resetMethod === 'phone') {
        setTargetStudentDocId(studentDocId);
        setTargetStudentData(studentData);
        setResetLookupToken(lookupToken);

        let formattedPhone = forgotPhone.trim().replace(/\s/g, '');
        if (formattedPhone.startsWith('0')) {
          formattedPhone = '+84' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('84') && !formattedPhone.startsWith('+')) {
          formattedPhone = '+' + formattedPhone;
        } else if (!formattedPhone.startsWith('+')) {
          formattedPhone = '+84' + formattedPhone;
        }

        try {
          const response = await fetch('/api/v1/auth/request-sms-otp', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({
              studentDocId,
              loginType: type,
              phone: formattedPhone,
              lookupToken,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || typeof data.challengeId !== 'string') {
            throw new Error(data.error || 'Unable to send SMS OTP');
          }
          setConfirmationResult({ challengeId: data.challengeId });
          setResendTimer(60);

          setForgotStatus({
            type: 'otp_sent',
            message: t.authErrors.smsOtpSent.replace('{phone}', forgotPhone),
          });
        } catch (phoneErr: any) {
          console.error('Phone auth failed:', phoneErr);
          throw phoneErr;
        }
      } else if (resetMethod === 'request') {
        const requestId = normalizedId; // Use G8-01 or PHG8-01

        // Pending request check is already done by lookup-student endpoint

        await apiRequest('/api/v1/auth/create-password-request', {
          method: 'POST',
          body: {
            requestId,
            userId: requestId,
            studentDocId: studentDocId,
            type: type,
            method: 'manual_request',
            lookupToken,
          },
        });
        setForgotStatus({
          type: 'success',
          message: localize(
            language,
            'Yêu cầu của bạn đã được gửi tới giáo viên. Vui lòng đợi giáo viên phê duyệt và cấp lại mật khẩu mới.',
            'Your request has been sent to the teacher. Please wait for approval to reset your password.'
          ),
        });
      }
    } catch (err: any) {
      console.error('Forgot password failed error object:', err);
      let msg = err.message;
      if (err.code === 'auth/too-many-requests') {
        msg = t.auth.forgotModal.tooManyRequests;
      } else if (err.code === 'auth/invalid-phone-number') {
        msg = t.authErrors.invalidPhone;
      } else if (err.code === 'auth/operation-not-allowed') {
        msg = t.authErrors.smsNotEnabled;
      } else if (err.code === 'auth/captcha-check-failed') {
        msg = t.authErrors.captchaFailed;
      } else if (err.code === 'auth/invalid-app-credential') {
        msg = t.authErrors.invalidAppCredential;
      }
      setForgotStatus({ type: 'error', message: msg });
      setForgotError(msg);
    } finally {
      setIsProcessingForgot(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || isProcessingForgot) return;
    if (resetMethod === 'phone' && !confirmationResult) return;

    setIsProcessingForgot(true);
    setForgotStatus({ type: 'loading' });
    setForgotError(null);

    try {
      if (resetMethod === 'phone') {
        const response = await fetch('/api/v1/auth/verify-sms-otp', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            challengeId: confirmationResult!.challengeId,
            otp: otpCode.trim(),
            lookupToken: resetLookupToken,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.resetToken !== 'string') {
          throw new Error(data.error || t.authErrors.otpIncorrectOrExpired);
        }
        setResetLookupToken(data.resetToken);
        setForgotStatus({ type: 'otp_verified' });
      } else if (resetMethod === 'zalo') {
        let queryId = forgotId.trim().toUpperCase();
        const type = queryId.startsWith('PH') ? 'parent' : 'student';
        if (queryId.startsWith('PH')) queryId = queryId.substring(2);

        const response = await fetch('/api/v1/auth/verify-zalo-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentCode: queryId,
            loginType: type,
            otp: otpCode.trim(),
          }),
        });
        const text = await response.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          data = {};
        }
        if (!response.ok || !data.success) {
          throw new Error(data.error || t.authErrors.otpIncorrectOrExpired);
        }

        setZaloResetToken(data.resetToken);
        setTargetStudentDocId(data.studentDocId);
        setForgotStatus({ type: 'otp_verified' });
      }
    } catch (err: any) {
      console.error('OTP verification failed:', err);
      setForgotStatus({
        type: 'otp_sent',
        message: t.authErrors.otpIncorrectOrExpired,
      });
      setForgotError(t.authErrors.otpIncorrectOrExpired);
    } finally {
      setIsProcessingForgot(false);
    }
  };

  const handleStaffForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffForgotEmail.trim() || isProcessingStaffForgot) return;

    if (staffForgotMethod === 'zalo' && !staffForgotPhone.trim()) {
      setStaffForgotError(t.staffForgotPasswordModal.phoneRequired);
      return;
    }

    setIsProcessingStaffForgot(true);
    setStaffForgotError(null);
    setStaffForgotSuccess(false);
    setStaffForgotStatus({ type: 'loading' });

    try {
      const email = staffForgotEmail.trim().toLowerCase();

      if (staffForgotMethod === 'request') {
        const response = await fetch('/api/v1/auth/staff-forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        const text = await response.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(text || `Server error (${response.status})`);
        }
        if (!data.success) {
          setStaffForgotStatus({ type: 'error' });
          setStaffForgotError(
            data.error || localize(language, 'Lỗi khi gửi yêu cầu.', 'Error sending request.')
          );
          return;
        }

        setStaffForgotSuccess(true);
        setStaffForgotStatus({
          type: 'success',
          message: t.staffForgotPasswordModal.successMessage,
        });
        return;
      }

      const response = await fetch('/api/v1/auth/request-zalo-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginType: 'staff',
          email,
          phone: staffForgotPhone.trim(),
        }),
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
      if (!response.ok || !data.success) {
        throw new Error(
          data.error || t.authErrors.serverError.replace('{status}', String(response.status))
        );
      }

      setResendTimer(60);
      setStaffForgotStatus({
        type: 'otp_sent',
        message: t.staffForgotPasswordModal.otpSentGeneric,
      });
    } catch (err: any) {
      console.error('Staff forgot password error:', err);
      const message =
        err?.message ||
        localize(
          language,
          'Lỗi khi gửi yêu cầu. Vui lòng thử lại.',
          'Error sending request. Please try again.'
        );
      setStaffForgotStatus({ type: 'error', message });
      setStaffForgotError(message);
    } finally {
      setIsProcessingStaffForgot(false);
    }
  };

  const handleVerifyStaffForgotOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffForgotOtp.trim() || isProcessingStaffForgot) return;

    setIsProcessingStaffForgot(true);
    setStaffForgotError(null);
    setStaffForgotStatus({ type: 'loading' });

    try {
      const response = await fetch('/api/v1/auth/verify-zalo-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginType: 'staff',
          email: staffForgotEmail.trim().toLowerCase(),
          otp: staffForgotOtp.trim(),
        }),
      });
      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
      if (!response.ok || !data.success) {
        throw new Error(data.error || t.authErrors.otpIncorrectOrExpired);
      }

      setStaffForgotResetToken(data.resetToken);
      setStaffForgotStatus({ type: 'otp_verified' });
    } catch (err: any) {
      console.error('Staff OTP verification failed:', err);
      setStaffForgotStatus({
        type: 'otp_sent',
        message: t.authErrors.otpIncorrectOrExpired,
      });
      setStaffForgotError(t.authErrors.otpIncorrectOrExpired);
    } finally {
      setIsProcessingStaffForgot(false);
    }
  };

  const handleResetStaffForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (staffForgotNewPassword !== staffForgotConfirmPassword) {
      setStaffForgotError(t.authErrors.passwordMismatch);
      return;
    }

    const pwValidation = validatePasswordStrength(staffForgotNewPassword);
    if (!pwValidation.valid) {
      setStaffForgotError(pwValidation.error!);
      return;
    }
    if (!staffForgotResetToken || isProcessingStaffForgot) return;

    setIsProcessingStaffForgot(true);
    setStaffForgotError(null);
    setStaffForgotStatus({ type: 'loading' });

    try {
      const response = await fetch('/api/v1/auth/reset-password-zalo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginType: 'staff',
          email: staffForgotEmail.trim().toLowerCase(),
          resetToken: staffForgotResetToken,
          newPassword: staffForgotNewPassword,
        }),
      });
      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
      if (!response.ok || !data.success) {
        throw new Error(data.error || t.authErrors.resetPasswordError);
      }

      setStaffForgotSuccess(true);
      setStaffForgotStatus({
        type: 'success',
        message: t.staffForgotPasswordModal.passwordChanged,
      });

      setTimeout(() => {
        setShowStaffForgotModal(false);
        setStaffForgotStatus({ type: 'idle' });
        setStaffForgotEmail('');
        setStaffForgotPhone('');
        setStaffForgotOtp('');
        setStaffForgotResetToken(null);
        setStaffForgotNewPassword('');
        setStaffForgotConfirmPassword('');
        setStaffForgotError(null);
        setStaffForgotSuccess(false);
      }, 3000);
    } catch (err: any) {
      console.error('Staff password reset failed:', err);
      setStaffForgotStatus({ type: 'otp_verified' });
      setStaffForgotError(t.authErrors.resetPasswordUpdateError + (err.message || ''));
    } finally {
      setIsProcessingStaffForgot(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setForgotError(t.authErrors.passwordMismatch);
      return;
    }
    const pwValidation = validatePasswordStrength(newPassword);
    if (!pwValidation.valid) {
      setForgotError(pwValidation.error!);
      return;
    }
    if (!targetStudentDocId || isProcessingForgot) return;

    setIsProcessingForgot(true);
    setForgotStatus({ type: 'loading' });
    setForgotError(null);

    try {
      if (resetMethod === 'zalo') {
        let queryId = forgotId.trim().toUpperCase();
        const type = queryId.startsWith('PH') ? 'parent' : 'student';
        if (queryId.startsWith('PH')) queryId = queryId.substring(2);

        const response = await fetch('/api/v1/auth/reset-password-zalo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentCode: queryId,
            loginType: type,
            resetToken: zaloResetToken,
            newPassword: newPassword,
          }),
        });
        const text = await response.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          data = {};
        }
        if (!response.ok || !data.success) {
          throw new Error(data.error || t.authErrors.resetPasswordError);
        }
      } else {
        // Server-side hashing — password never written directly from client
        const response = await fetch('/api/v1/auth/reset', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            studentDocId: targetStudentDocId,
            type: resetType,
            newPassword: newPassword,
            lookupToken: resetLookupToken,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Password reset failed');
        }
      }

      setForgotStatus({
        type: 'success',
        message: t.authErrors.passwordChanged,
      });

      // Cleanup
      setTimeout(() => {
        setShowForgotModal(false);
        setForgotStatus({ type: 'idle' });
        setForgotId('');
        setForgotPhone('');
        setOtpCode('');
        setNewPassword('');
        setConfirmNewPassword('');
        setForgotError(null);
        setZaloResetToken(null);
        setResetLookupToken(null);
      }, 3000);
    } catch (err: any) {
      console.error('Password reset failed:', err);
      setForgotStatus({ type: 'otp_verified' });
      setForgotError(t.authErrors.resetPasswordUpdateError + err.message);
    } finally {
      setIsProcessingForgot(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // Language & auth context
    language,
    t,
    T,

    // Login type (UI tab state)
    loginType,
    setLoginType,

    // General login state
    error,
    setError,
    isLoggingIn,
    setIsLoggingIn,

    // Staff login state
    staffEmail,
    setStaffEmail,
    staffPassword,
    setStaffPassword,

    // Student/Parent login state
    studentCode,
    setStudentCode,
    studentPassword,
    setStudentPassword,

    // Forgot password state
    showForgotModal,
    setShowForgotModal,
    forgotId,
    setForgotId,
    forgotPhone,
    setForgotPhone,
    zaloResetToken,
    setZaloResetToken,
    resetMethod,
    setResetMethod,
    otpCode,
    setOtpCode,
    newPassword,
    setNewPassword,
    confirmNewPassword,
    setConfirmNewPassword,
    forgotError,
    setForgotError,
    isProcessingForgot,
    setIsProcessingForgot,
    forgotStatus,
    setForgotStatus,
    confirmationResult,
    setConfirmationResult,
    targetStudentDocId,
    setTargetStudentDocId,
    targetStudentData,
    setTargetStudentData,
    resetType,
    setResetType,

    // Staff forgot password state
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
    staffForgotResetToken,
    setStaffForgotResetToken,
    staffForgotNewPassword,
    setStaffForgotNewPassword,
    staffForgotConfirmPassword,
    setStaffForgotConfirmPassword,
    staffForgotError,
    setStaffForgotError,
    staffForgotSuccess,
    setStaffForgotSuccess,
    staffForgotStatus,
    setStaffForgotStatus,
    isProcessingStaffForgot,
    setIsProcessingStaffForgot,

    // Resend timer
    resendTimer,
    setResendTimer,

    // Rate limiting (internal, but exposed for potential use)
    loginAttempts,
    lockoutUntil,

    // Turnstile bot verification
    turnstileSiteKey,
    turnstileToken,
    setTurnstileToken,
    turnstileWidgetRef,
    resetTurnstile,
    isTurnstileReady: Boolean(turnstileSiteKey && turnstileToken),

    // Handler functions
    recordFailedLoginAttempt,
    handleStaffLogin,
    handleGoogleLogin,
    handleCodeLogin,
    handleForgotPassword,
    handleVerifyOtp,
    handleStaffForgotPassword,
    handleVerifyStaffForgotOtp,
    handleResetStaffForgotPassword,
    handleResetPassword,
  };
}
