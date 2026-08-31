import { useEffect, useState } from 'react';
import { beginLogin, completeLogin, getSession, logout, type SessionInfo } from './api.js';
import { OpsShell } from './components/OpsShell.js';
import { LoginForm } from './components/LoginForm.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { VariablesPage } from './pages/VariablesPage.js';
import { useOpsRoute } from './routing.js';

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="panel placeholder-page">
      <p className="eyebrow">OPS CONSOLE</p>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
    </section>
  );
}

export function App() {
  const route = useOpsRoute();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main className="loading-shell">Đang tải…</main>;
  if (!session) {
    return (
      <LoginForm
        error={loginError}
        onBegin={async (credentials) => {
          try {
            const result = await beginLogin(credentials);
            setLoginError(null);
            return result;
          } catch {
            setLoginError('Thông tin đăng nhập không hợp lệ.');
            throw new Error('LOGIN_FAILED');
          }
        }}
        onComplete={async (input) => {
          try {
            const result = await completeLogin(input);
            setSession(result);
            setLoginError(null);
            return result;
          } catch {
            setLoginError('Mã xác thực không hợp lệ.');
            throw new Error('MFA_FAILED');
          }
        }}
      />
    );
  }

  return (
    <OpsShell
      session={session}
      activeRoute={route}
      onLogout={async () => {
        try {
          if (session.csrfToken) await logout(session.csrfToken);
        } finally {
          setSession(null);
        }
      }}
    >
      {route === '/' ? (
        <OverviewPage session={session} onUnauthorized={() => setSession(null)} />
      ) : route === '/users' ? (
        <UsersPage session={session} onUnauthorized={() => setSession(null)} />
      ) : route === '/variables' ? (
        <VariablesPage session={session} onUnauthorized={() => setSession(null)} />
      ) : (
        <PlaceholderPage
          title="Thiết lập MFA"
          description="Thiết lập MFA bootstrap sẽ được tải ở đây."
        />
      )}
    </OpsShell>
  );
}
