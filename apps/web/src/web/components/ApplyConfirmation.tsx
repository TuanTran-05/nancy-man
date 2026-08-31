import { useState } from 'react';

export function ApplyConfirmation({
  digest,
  onConfirm,
  onCancel
}: {
  digest: string;
  onConfirm: (input: { password: string; totpCode: string }) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Xác nhận áp dụng">
      <h3>Xác nhận áp dụng</h3>
      <p className="muted">
        Digest hiện tại: <code>{digest}</code>
      </p>
      <label>
        Mật khẩu
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label>
        Mã TOTP
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={totpCode}
          onChange={(event) => setTotpCode(event.target.value)}
        />
      </label>
      <div className="variables-actions">
        <button type="button" onClick={onCancel}>
          Hủy
        </button>
        <button
          type="button"
          disabled={!password || !/^\d{6}$/u.test(totpCode)}
          onClick={() => onConfirm({ password, totpCode })}
        >
          Xác nhận
        </button>
      </div>
    </div>
  );
}
