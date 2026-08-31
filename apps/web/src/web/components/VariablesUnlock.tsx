import { useState, type FormEvent } from 'react';

export function VariablesUnlock({
  onUnlock,
  error
}: {
  onUnlock: (input: { password: string; totpCode: string }) => Promise<void>;
  error: string | null;
}) {
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onUnlock({ password, totpCode });
      setPassword('');
      setTotpCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel variables-unlock" aria-labelledby="variables-unlock-heading">
      <p className="eyebrow">STEP-UP / SENSITIVE VALUES</p>
      <h2 id="variables-unlock-heading">Mở khóa Variables</h2>
      <p className="muted">
        Xác nhận bằng mật khẩu hiện tại và mã TOTP. Giá trị chỉ tồn tại trong trang này và sẽ tự xóa
        khi hết hạn.
      </p>
      <form onSubmit={submit} noValidate>
        <label>
          Mật khẩu hiện tại
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          Mã TOTP
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value)}
            autoComplete="one-time-code"
            required
          />
        </label>
        {error ? (
          <p role="alert" className="alert-text">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Đang xác nhận…' : 'Mở khóa giá trị'}
        </button>
      </form>
    </section>
  );
}
