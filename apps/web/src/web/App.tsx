import { useCallback, useEffect, useState } from 'react';
import type { DashboardOverview, Incident } from '../shared/models.js';
import {
  acknowledgeIncident,
  getOverview,
  getSession,
  getZaloLink,
  login,
  logout,
  type SessionInfo,
  type ZaloLinkInfo
} from './api.js';
import { AcknowledgeDialog } from './components/AcknowledgeDialog.js';
import { IncidentList } from './components/IncidentList.js';
import { InfrastructureSection } from './components/InfrastructureSection.js';
import { LoginForm } from './components/LoginForm.js';
import { MonitorPanel } from './components/MonitorPanel.js';
import { OverviewCards } from './components/OverviewCards.js';
import { ZaloLinkPanel } from './components/ZaloLinkPanel.js';

const monitorOrder = [
  'app_liveness',
  'app_health',
  'app_process',
  'postgres',
  'cron',
  'backup',
  'errors',
  'collector',
  'beszel',
  'host_resources',
  'host_services'
] as const;

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [zaloLink, setZaloLink] = useState<ZaloLinkInfo | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextLink] = await Promise.all([getOverview(), getZaloLink()]);
      setOverview(nextOverview);
      setZaloLink(nextLink);
    } catch (error) {
      if (String(error).includes('HTTP_401')) setSession(null);
    }
  }, []);
  useEffect(() => {
    getSession()
      .then(setSession)
      .then(refresh)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [session, refresh]);
  if (loading) return <main className="loading-shell">Đang tải…</main>;
  if (!session)
    return (
      <LoginForm
        error={loginError}
        onLogin={async (credentials) => {
          try {
            const next = await login(credentials);
            setSession(next);
            setLoginError(null);
            await refresh();
          } catch {
            setLoginError('Thông tin đăng nhập không hợp lệ.');
          }
        }}
      />
    );
  if (!overview) return <main className="loading-shell">Đang chờ snapshot…</main>;
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">THIEN UY / OPS</p>
          <h1>Ops Console</h1>
        </div>
        <div className="header-actions">
          <span className="muted">{session.username}</span>
          <button
            type="button"
            onClick={() =>
              logout(session.csrfToken)
                .then(() => setSession(null))
                .catch(() => setSession(null))
            }
          >
            Đăng xuất
          </button>
        </div>
      </header>
      <OverviewCards overview={overview} />
      <InfrastructureSection overview={overview} />
      {zaloLink ? (
        <ZaloLinkPanel info={zaloLink} csrfToken={session.csrfToken} onChanged={refresh} />
      ) : null}
      <section>
        <h2>Monitor</h2>
        <div className="monitor-grid">
          {monitorOrder.map((monitor) => (
            <MonitorPanel
              key={monitor}
              monitor={monitor}
              sample={overview.latestByMonitor[monitor]}
            />
          ))}
        </div>
      </section>
      <IncidentList incidents={overview.openIncidents} onAcknowledge={setSelectedIncident} />
      <p className="footer-note">Console chỉ hiển thị trạng thái vận hành của hệ thống.</p>
      {selectedIncident ? (
        <AcknowledgeDialog
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onSubmit={async (note) => {
            await acknowledgeIncident(selectedIncident.id, note, session.csrfToken);
            setSelectedIncident(null);
            await refresh();
          }}
        />
      ) : null}
    </main>
  );
}
