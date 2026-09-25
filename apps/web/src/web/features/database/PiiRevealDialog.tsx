import { captureBrowserException } from '../../telemetry/runtimeTelemetry.js';

import { useEffect, useRef, useState, type FormEvent } from 'react';

export type PiiRevealDialogProps = {
  open: boolean;
  targetName: string;
  onClose: () => void;
  onSubmit: (password: string, token: string, reason: string) => Promise<void>;
};

export function PiiRevealDialog({ open, targetName, onClose, onSubmit }: PiiRevealDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeHandlerRef = useRef<() => void>(() => {});
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setPassword('');
    setToken('');
    setReason('');
    setError(null);
    onClose();
  };
  closeHandlerRef.current = handleClose;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    passwordInputRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHandlerRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Vui lòng nhập mật khẩu tài khoản');
      return;
    }
    if (!/^\d{6}$/.test(token)) {
      setError('Mã xác thực TOTP phải gồm đúng 6 chữ số');
      return;
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 10 || trimmedReason.length > 500) {
      setError('Lý do truy cập phải từ 10 đến 500 ký tự');
      return;
    }

    setLoading(true);
    setError(null);

    const submittedPassword = password;
    const submittedToken = token;
    // Clear immediately from component state to avoid holding in memory
    setPassword('');
    setToken('');

    try {
      await onSubmit(submittedPassword, submittedToken, trimmedReason);
      setReason('');
    } catch (err: unknown) {
      void captureBrowserException(err, {
        code: 'UNHANDLED_BROWSER_EXCEPTION',
        source: 'browser',
        route: () => globalThis.location?.pathname
      });
      const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
      const msg =
        typeof errObj['code'] === 'string'
          ? errObj['code']
          : typeof errObj['message'] === 'string'
            ? errObj['message']
            : 'Xác thực thất bại. Vui lòng kiểm tra lại mật khẩu và mã TOTP.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pii-dialog-title"
      aria-describedby="pii-dialog-description"
    >
      <div className="modal-content" ref={dialogRef} tabIndex={-1}>
        <header className="modal-header">
          <h2 id="pii-dialog-title">Mở khóa dữ liệu nhạy cảm (PII)</h2>
          <button type="button" className="close-button" onClick={handleClose} aria-label="Đóng">
            ✕
          </button>
        </header>

        <p className="modal-description" id="pii-dialog-description">
          Bạn đang yêu cầu mở khóa hiển thị dữ liệu PII trên database <strong>{targetName}</strong>.
          Quyền truy cập có hiệu lực trong 10 phút và mọi thao tác xem dữ liệu sẽ được ghi nhận vào
          nhật ký kiểm toán (Audit Log).
        </p>

        {error ? (
          <div className="modal-error" role="alert">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="modal-form">
          <label htmlFor="pii-password">
            <span>Mật khẩu tài khoản</span>
            <input
              ref={passwordInputRef}
              id="pii-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu tài khoản của bạn"
              disabled={loading}
              required
            />
          </label>

          <label htmlFor="pii-totp">
            <span>Mã xác thực TOTP (6 số)</span>
            <input
              id="pii-totp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              disabled={loading}
              required
            />
          </label>

          <label htmlFor="pii-reason">
            <span>Lý do truy cập (tối thiểu 10 ký tự)</span>
            <textarea
              id="pii-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: Kiểm tra thông tin phụ huynh theo ticket INC-1234..."
              disabled={loading}
              required
            />
          </label>

          <footer className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleClose}
              disabled={loading}
            >
              Hủy
            </button>
            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? 'Đang xác thực…' : 'Xác thực & Mở khóa'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
