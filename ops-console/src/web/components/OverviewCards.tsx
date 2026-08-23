import type { DashboardOverview } from '../../shared/models.js';

export function isOverviewStale(collectedAt: string | null, now = Date.now()): boolean {
  return !collectedAt || !Number.isFinite(Date.parse(collectedAt)) || now - Date.parse(collectedAt) > 45_000;
}

export function OverviewCards({ overview }: { overview: DashboardOverview }) {
  const stale = isOverviewStale(overview.collectedAt);
  const openCount = overview.openIncidents.length;
  return <section className="overview-section"><div className={`status-banner ${stale ? 'status-stale' : openCount ? 'status-warning' : 'status-healthy'}`}><span>{stale ? 'Dữ liệu cũ' : openCount ? 'Có sự cố cần xử lý' : 'Hệ thống đang theo dõi'}</span><span>{overview.collectedAt ? `Cập nhật: ${new Date(overview.collectedAt).toLocaleString('vi-VN')}` : 'Chưa có snapshot'}</span></div><div className="card-grid"><article className="metric-card"><span className="muted">Sự cố đang mở</span><strong>{openCount}</strong></article><article className="metric-card"><span className="muted">Monitor đã thu thập</span><strong>{Object.keys(overview.latestByMonitor).length}</strong></article><article className="metric-card"><span className="muted">Alert gần đây</span><strong>{overview.recentDeliveries.length}</strong></article></div></section>;
}
