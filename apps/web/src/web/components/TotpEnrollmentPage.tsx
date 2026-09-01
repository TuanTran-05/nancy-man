import { useEffect, useState, type FormEvent } from 'react';

import { completeTotpEnrollment, startTotpEnrollment, type TotpEnrollment } from '../api.js';

type EnrollmentContext = { userId: string; token: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function readEnrollmentContext(): EnrollmentContext | null {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/u, ''));
  const userId = parameters.get('userId') ?? '';
  const token = parameters.get('token') ?? '';
  if (!uuid.test(userId) || token.length < 32 || token.length > 256) return null;
  return { userId, token };
}

export function TotpEnrollmentPage({ onComplete }: { onComplete: () => void }) {
  const [context, setContext] = useState<EnrollmentContext | null>(() => readEnrollmentContext());
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const begin = async () => {
    if (!context) return;
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await startTotpEnrollment(context));
    } catch {
      setError('Liên kết thiết lập không hợp lệ hoặc đã hết hạn.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!context || !enrollment) return;
    if (password.length < 14) {
      setError('Mật khẩu mới phải có ít nhất 14 ký tự.');
      return;
    }
    if (password !== confirmation) {
      setError('Hai trường mật khẩu chưa trùng khớp.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeTotpEnrollment({
        ...context,
        factorId: enrollment.factorId,
        otp,
        password
      });
      setPassword('');
      setConfirmation('');
      setOtp('');
      setEnrollment(null);
      setContext(null);
      onComplete();
    } catch {
      setError('Không thể kích hoạt tài khoản. Hãy kiểm tra mã xác thực và thử lại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="login-card enrollment-card" onSubmit={submit} noValidate>
        <p className="eyebrow">THIEN UY / OPS</p>
        <h1>Thiết lập xác thực hai lớp</h1>
        {!context ? (
          <p role="alert" className="alert-text">
            Liên kết thiết lập không hợp lệ. Hãy yêu cầu một liên kết mới.
          </p>
        ) : !enrollment ? (
          <>
            <p className="muted">
              Liên kết chỉ dùng một lần. Chuẩn bị ứng dụng xác thực trước khi tiếp tục.
            </p>
            <button type="button" disabled={busy} onClick={() => void begin()}>
              {busy ? 'Đang chuẩn bị…' : 'Bắt đầu thiết lập MFA'}
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Thêm khóa dưới đây vào ứng dụng xác thực, sau đó nhập mã 6 chữ số vừa tạo.
            </p>
            <label>
              Khóa thiết lập thủ công
              <input
                className="enrollment-secret"
                value={enrollment.secret}
                readOnly
                autoComplete="off"
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <a className="enrollment-uri" href={enrollment.otpauthUri} rel="noreferrer">
              Mở bằng ứng dụng xác thực
            </a>
            <label>
              Mật khẩu mới
              <input
                aria-label="Mật khẩu mới"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={14}
                required
              />
            </label>
            <label>
              Xác nhận mật khẩu
              <input
                aria-label="Xác nhận mật khẩu"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={14}
                required
              />
            </label>
            <label>
              Mã xác thực
              <input
                aria-label="Mã xác thực"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </label>
          </>
        )}
        {error ? (
          <p role="alert" className="alert-text">
            {error}
          </p>
        ) : null}
        {context && enrollment ? (
          <button type="submit" disabled={busy}>
            {busy ? 'Đang kích hoạt…' : 'Kích hoạt tài khoản'}
          </button>
        ) : null}
      </form>
    </main>
  );
}
