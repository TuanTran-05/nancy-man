import { useCallback, useEffect, useState } from 'react';
import type { DashboardOverview, Incident } from '../shared/models.js';
import { acknowledgeIncident, getOverview, getSession, login, logout, type SessionInfo } from './api.js';
import { AcknowledgeDialog } from './components/AcknowledgeDialog.js';
import { IncidentList } from './components/IncidentList.js';
import { LoginForm } from './components/LoginForm.js';
import { MonitorPanel } from './components/MonitorPanel.js';
import { OverviewCards } from './components/OverviewCards.js';

const monitorOrder = ['app_liveness', 'app_health', 'app_process', 'postgres', 'cron', 'backup', 'errors', 'collector'] as const;

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { try { setOverview(await getOverview()); } catch (error) { if (String(error).includes('HTTP_401')) setSession(null); } }, []);
  useEffect(() => { getSession().then(setSession).then(refresh).catch(() => undefined).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => { if (!session) return undefined; const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000); return () => window.clearInterval(timer); }, [session, refresh]);
  if (loading) return <main className="loading-shell">Đang tải…</main>;
  if (!session) return <LoginForm error={loginError} onLogin={async (credentials) => { try { const next = await login(credentials); setSession(next); setLoginError(null); await refresh(); } catch { setLoginError('Thông tin đăng nhập không hợp lệ.'); } }} />;
  if (!overview) return <main className="loading-shell">Đang chờ snapshot…</main>;
  return <main className="app-shell"><header className="app-header"><div><p className="eyebrow">THIEN UY / OPS</p><h1>Ops Console</h1></div><div className="header-actions"><span className="muted">{session.username}</span><button type="button" onClick={() => logout(session.csrfToken).then(() => setSession(null)).catch(() => setSession(null))}>Đăng xuất</button></div></header><OverviewCards overview={overview} /><section><h2>Monitor</h2><div className="monitor-grid">{monitorOrder.map((monitor) => <MonitorPanel key={monitor} monitor={monitor} sample={overview.latestByMonitor[monitor]} />)}</div></section><IncidentList incidents={overview.openIncidents} onAcknowledge={setSelectedIncident} /><p className="footer-note">Console chỉ đọc trạng thái vận hành. Không có thao tác SQL, restart hoặc thay đổi EduTrack.</p>{selectedIncident ? <AcknowledgeDialog incident={selectedIncident} onClose={() => setSelectedIncident(null)} onSubmit={async (note) => { await acknowledgeIncident(selectedIncident.id, note, session.csrfToken); setSelectedIncident(null); await refresh(); }} /> : null}</main>;
}
