import { useCallback, useEffect, useState } from 'react';
import type { DashboardOverview, Incident } from '../../shared/models.js';
import {
  acknowledgeIncident,
  getInfrastructureHistory,
  getOverview,
  getZaloLink,
  type SessionInfo,
  type ZaloLinkInfo
} from '../api.js';
import { AcknowledgeDialog } from '../components/AcknowledgeDialog.js';
import { IncidentList } from '../components/IncidentList.js';
import { InfrastructureSection } from '../components/InfrastructureSection.js';
import { MonitorPanel } from '../components/MonitorPanel.js';
import { OverviewCards } from '../components/OverviewCards.js';
import { ZaloLinkPanel } from '../components/ZaloLinkPanel.js';

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

export function OverviewPage({
  session,
  onUnauthorized
}: {
  session: SessionInfo;
  onUnauthorized: () => void;
}) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [zaloLink, setZaloLink] = useState<ZaloLinkInfo | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextLink] = await Promise.all([getOverview(), getZaloLink()]);
      setOverview(nextOverview);
      setZaloLink(nextLink);
    } catch (error) {
      if (String(error).includes('401') || String(error).includes('UNAUTHENTICATED')) {
        onUnauthorized();
      }
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!overview) return <p className="loading-panel">Đang chờ snapshot…</p>;

  return (
    <>
      <OverviewCards overview={overview} />
      <InfrastructureSection overview={overview} loadHistory={getInfrastructureHistory} />
      {zaloLink ? (
        <ZaloLinkPanel info={zaloLink} csrfToken={session.csrfToken ?? ''} onChanged={refresh} />
      ) : null}
      <section>
        <h2>Monitor</h2>
        <div className="monitor-grid">
          {monitorOrder.map((monitor) => (
            <MonitorPanel key={monitor} monitor={monitor} sample={overview.latestByMonitor[monitor]} />
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
            await acknowledgeIncident(selectedIncident.id, note, session.csrfToken ?? '');
            setSelectedIncident(null);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}
