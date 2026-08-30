import { useState, type FormEvent } from 'react';

export function LoginForm({
  onLogin,
  error
}: {
  onLogin: (credentials: { username: string; password: string; totp: string }) => Promise<void>;
  error: string | null;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onLogin({ username, password, totp });
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit} noValidate>
        <p className="eyebrow">THIEN UY / OPS</p>
        <h1>Ops Console</h1>
        <p className="muted">Đăng nhập bằng tài khoản vận hành độc lập.</p>
        <label>
          Tên đăng nhập
          <input
            aria-label="Tên đăng nhập"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Mật khẩu
          <input
            aria-label="Mật khẩu"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
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
            value={totp}
            onChange={(event) => setTotp(event.target.value)}
            required
          />
        </label>
        {error ? (
          <p role="alert" className="alert-text">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Đang xác thực…' : 'Đăng nhập'}
        </button>
      </form>
    </main>
  );
}
