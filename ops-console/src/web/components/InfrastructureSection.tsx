import { useEffect, useState } from 'react';
import type { DashboardOverview, InfrastructureHistoryRange, InfrastructureHistoryResponse } from '../../shared/models.js';
import { getInfrastructureHistory } from '../api.js';
import { formatBytes, formatLoad, formatPercent, formatRate, isInfrastructureUnavailable } from '../infrastructure.js';
import { InfrastructureChart, type ChartMetric } from './InfrastructureChart.js';

type LoadHistory = (range: InfrastructureHistoryRange) => Promise<InfrastructureHistoryResponse>;
const defaultLoadHistory: LoadHistory = getInfrastructureHistory;
const ranges: InfrastructureHistoryRange[] = ['1h', '24h', '7d', '30d'];
const numberValue = (details: Record<string, unknown>, key: string): number | null => typeof details[key] === 'number' && Number.isFinite(details[key]) ? details[key] as number : null;
const textValue = (details: Record<string, unknown>, key: string): string | null => typeof details[key] === 'string' ? details[key] as string : null;

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="metric-card infra-metric-card"><span className="muted">{title}</span>{children}</article>;
}

function ServiceList({ overview }: { overview: DashboardOverview }) {
  const raw = overview.latestByMonitor.host_services?.details.services;
  const services = Array.isArray(raw) ? raw.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.name !== 'string' || typeof item.state !== 'string' || typeof item.subState !== 'string') return [];
    return [{ name: item.name, state: item.state, subState: item.subState, cpuPercent: numberValue(item, 'cpuPercent'), memoryBytes: numberValue(item, 'memoryBytes'), failed: item.state === 'failed' || item.subState === 'failed' }];
  }).sort((a, b) => a.failed !== b.failed ? a.failed ? -1 : 1 : a.name.localeCompare(b.name, 'vi')) : [];
  return <div className="infra-service-list">{services.length ? services.map((service) => <div className="infra-service-row" data-testid="service-row" key={service.name}><div><strong>{service.name}</strong><span className={`level level-${service.failed ? 'critical' : 'healthy'}`}>{service.state} · {service.subState}</span></div><span>{formatPercent(service.cpuPercent)} · {formatBytes(service.memoryBytes)}</span></div>) : <p className="muted">Không có service phù hợp.</p>}</div>;
}

export function InfrastructureSection({ overview, now = Date.now(), loadHistory = defaultLoadHistory }: { overview: DashboardOverview; now?: number; loadHistory?: LoadHistory }) {
  const [range, setRange] = useState<InfrastructureHistoryRange>('24h');
  const [historyState, setHistoryState] = useState<{ kind: 'loading' } | { kind: 'ready'; value: InfrastructureHistoryResponse } | { kind: 'error' }>({ kind: 'loading' });
  useEffect(() => {
    let active = true;
    setHistoryState({ kind: 'loading' });
    loadHistory(range).then((value) => { if (active) setHistoryState({ kind: 'ready', value }); }, () => { if (active) setHistoryState({ kind: 'error' }); });
    return () => { active = false; };
  }, [range, loadHistory]);

  const unavailable = isInfrastructureUnavailable(overview, now);
  const details = overview.latestByMonitor.host_resources?.details ?? {};
  const value = (key: string): number | null => unavailable ? null : numberValue(details, key);
  const charts: Array<{ metric: ChartMetric; label: string; color: string; formatter: (value: number | null) => string }> = [
    { metric: 'cpuPercent', label: 'CPU', color: '#67e8f9', formatter: formatPercent },
    { metric: 'memoryPercent', label: 'RAM', color: '#a7f3d0', formatter: formatPercent },
    { metric: 'networkReceiveBytesPerSecond', label: 'Network nhận', color: '#c4b5fd', formatter: formatRate },
    { metric: 'diskReadBytesPerSecond', label: 'Disk I/O đọc', color: '#fcd34d', formatter: formatRate },
  ];
  const usedTotal = (usedKey: string, totalKey: string): string => `${formatBytes(value(usedKey))} / ${formatBytes(value(totalKey))}`;
  return <section className="infrastructure-section"><div className="panel-heading"><div><p className="eyebrow">INFRASTRUCTURE / VPS</p><h2>Hạ tầng VPS</h2></div><div className="infra-range" aria-label="Khoảng lịch sử">{ranges.map((item) => <button type="button" key={item} aria-pressed={range === item} disabled={range === item && historyState.kind === 'loading'} onClick={() => setRange(item)}>{item}</button>)}</div></div>{unavailable ? <div className="infra-unavailable" role="status">Telemetry hạ tầng không khả dụng</div> : null}<div className="infra-card-grid"><MetricCard title="CPU / load"><strong>{formatPercent(value('cpuPercent'))}</strong><span className="muted">Load {formatLoad(value('load1'))} / {formatLoad(value('load5'))}</span></MetricCard><MetricCard title="RAM / swap"><strong>{usedTotal('memoryUsedBytes', 'memoryTotalBytes')}</strong><span className="muted">{formatPercent(value('memoryPercent'))} · Swap {usedTotal('swapUsedBytes', 'swapTotalBytes')}</span></MetricCard><MetricCard title="Disk / I/O"><strong>{usedTotal('diskUsedBytes', 'diskTotalBytes')}</strong><span className="muted">{formatPercent(value('diskPercent'))} · Đọc {formatRate(value('diskReadBytesPerSecond'))} · Ghi {formatRate(value('diskWriteBytesPerSecond'))}</span></MetricCard><MetricCard title="Network"><strong>Nhận {formatRate(value('networkReceiveBytesPerSecond'))}</strong><span className="muted">Gửi {formatRate(value('networkTransmitBytesPerSecond'))}</span></MetricCard></div>{historyState.kind === 'error' ? <p className="alert-text" role="alert">Không tải được lịch sử hạ tầng.</p> : null}{historyState.kind === 'ready' ? <div className="infra-chart-grid">{charts.map((chart) => <InfrastructureChart key={chart.metric} history={historyState.value} {...chart} />)}</div> : null}<section className="infra-services"><div className="panel-heading"><div><h3>Systemd services</h3><p className="muted">Danh sách service đã match allowlist</p></div><span className="muted">{textValue(overview.latestByMonitor.host_services?.details ?? {}, 'metricObservedAt') ?? ''}</span></div><ServiceList overview={overview} /></section></section>;
}
