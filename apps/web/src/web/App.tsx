import { useEffect, useState } from 'react';
import { beginLogin, completeLogin, getSession, logout, type SessionInfo } from './api.js';
import { OpsShell } from './components/OpsShell.js';
import { LoginForm } from './components/LoginForm.js';
import { TotpEnrollmentPage } from './components/TotpEnrollmentPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { VariablesPage } from './pages/VariablesPage.js';
import { navigate, useOpsRoute } from './routing.js';

export function App() {
  const route = useOpsRoute();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (route === '/bootstrap/mfa') {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    getSession()
      .then((result) => {
        if (active) setSession(result);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [route]);

  if (route === '/bootstrap/mfa') {
    return <TotpEnrollmentPage onComplete={() => navigate('/')} />;
  }
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
      ) : null}
    </OpsShell>
  );
}
