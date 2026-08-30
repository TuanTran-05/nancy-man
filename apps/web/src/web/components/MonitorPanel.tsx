import type { MonitorName, MonitorSample } from '../../shared/models.js';

const labels: Record<MonitorName, string> = {
  app_liveness: 'Ứng dụng · liveness',
  app_health: 'Ứng dụng · health',
  app_process: 'Ứng dụng · process',
  postgres: 'PostgreSQL',
  errors: 'Lỗi',
  cron: 'Cron',
  backup: 'Backup',
  collector: 'Collector',
  beszel: 'Beszel telemetry',
  host_resources: 'Tài nguyên VPS',
  host_services: 'Systemd services'
};

export function MonitorPanel({
  monitor,
  sample
}: {
  monitor: MonitorName;
  sample?: MonitorSample;
}) {
  return (
    <article className="monitor-card">
      <div className="monitor-heading">
        <h3>{labels[monitor]}</h3>
        <span className={`level level-${sample?.level ?? 'unknown'}`}>
          {sample?.level ?? 'unknown'}
        </span>
      </div>
      <p className="muted">
        {sample
          ? `Mẫu lúc ${new Date(sample.observedAt).toLocaleString('vi-VN')}`
          : 'Không khả dụng'}
      </p>
      {sample?.latencyMs !== null && sample?.latencyMs !== undefined ? (
        <p>Độ trễ: {sample.latencyMs} ms</p>
      ) : (
        <p>Độ trễ: Không khả dụng</p>
      )}
      {sample?.errorCode ? <p className="alert-text">Mã: {sample.errorCode}</p> : null}
    </article>
  );
}
