import type { ReactNode } from 'react';
import { navigate, type OpsRoute } from '../routing.js';
import type { SessionInfo } from '../api.js';

export function OpsShell({
  session,
  activeRoute,
  onLogout,
  children
}: {
  session: SessionInfo;
  activeRoute: OpsRoute;
  onLogout: () => Promise<void>;
  children: ReactNode;
}) {
  const displayName = session.displayName ?? session.username ?? session.userId;
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">THIEN UY / OPS</p>
          <h1>Ops Console</h1>
        </div>
        <div className="header-actions">
          <span className="muted">{displayName}</span>
          <button type="button" onClick={() => void onLogout()}>
            Đăng xuất
          </button>
        </div>
      </header>
      <nav className="ops-nav" aria-label="Điều hướng Ops Console">
        <button
          type="button"
          className={activeRoute === '/' ? 'nav-active' : undefined}
          onClick={() => navigate('/')}
        >
          Tổng quan
        </button>
        <button
          type="button"
          className={activeRoute === '/variables' ? 'nav-active' : undefined}
          onClick={() => navigate('/variables')}
        >
          Variables
        </button>
        {session.role === 'ops_owner' ? (
          <button
            type="button"
            className={activeRoute === '/users' ? 'nav-active' : undefined}
            onClick={() => navigate('/users')}
          >
            Người dùng
          </button>
        ) : null}
      </nav>
      {children}
    </main>
  );
}
