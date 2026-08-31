import { useState, type FormEvent } from 'react';
import type { MfaFactor, MfaRequired, SessionInfo } from '../api.js';

export function LoginForm({
  onBegin,
  onComplete,
  error
}: {
  onBegin: (credentials: { identifier: string; password: string }) => Promise<MfaRequired>;
  onComplete: (input: {
    mfaChallenge: string;
    factorId: string;
    token: string;
  }) => Promise<SessionInfo>;
  error: string | null;
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [challenge, setChallenge] = useState<MfaRequired | null>(null);
  const [factorId, setFactorId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (!challenge) {
        const next = await onBegin({ identifier, password });
        setChallenge(next);
        setFactorId(next.factors[0]?.id ?? '');
      } else {
        await onComplete({ mfaChallenge: challenge.mfaChallenge, factorId, token });
      }
    } finally {
      setBusy(false);
    }
  };

  const factors: MfaFactor[] = challenge?.factors ?? [];
  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit} noValidate>
        <p className="eyebrow">THIEN UY / OPS</p>
        <h1>Ops Console</h1>
        <p className="muted">Đăng nhập bằng tài khoản vận hành độc lập.</p>
        {!challenge ? (
          <>
            <label>
              Tên đăng nhập
              <input
                aria-label="Tên đăng nhập"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
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
          </>
        ) : (
          <>
            <p className="muted">Bước 2/2: xác nhận MFA để hoàn tất phiên vận hành.</p>
            {factors.length > 1 ? (
              <label>
                Phương thức xác thực
                <select
                  aria-label="Phương thức xác thực"
                  value={factorId}
                  onChange={(event) => setFactorId(event.target.value)}
                >
                  {factors.map((factor) => (
                    <option key={factor.id} value={factor.id}>
                      {factor.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Mã xác thực
              <input
                aria-label="Mã xác thực"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={token}
                onChange={(event) => setToken(event.target.value)}
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
        <button type="submit" disabled={busy}>
          {busy ? 'Đang xác thực…' : challenge ? 'Hoàn tất đăng nhập' : 'Đăng nhập'}
        </button>
      </form>
    </main>
  );
}
