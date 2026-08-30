import type {
  InfrastructureHistoryPoint,
  InfrastructureHistoryResponse
} from '../../shared/models.js';
import { makeLineSegments, type ChartMetric } from '../infrastructure.js';

const rangeLabels: Record<InfrastructureHistoryResponse['range'], string> = {
  '1h': '1 giờ',
  '24h': '24 giờ',
  '7d': '7 ngày',
  '30d': '30 ngày'
};

export function InfrastructureChart({
  history,
  metric,
  label,
  color,
  formatter
}: {
  history: InfrastructureHistoryResponse;
  metric: ChartMetric;
  label: string;
  color: string;
  formatter: (value: number | null) => string;
}) {
  const segments = makeLineSegments(history.points, metric, 600, 120);
  const latest =
    [...history.points]
      .reverse()
      .map((point) => point[metric])
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ??
    null;
  const accessibleLabel = `${label} trong ${rangeLabels[history.range]}`;
  return (
    <article className="infra-chart-card">
      <div className="infra-chart-heading">
        <div>
          <h3>{label}</h3>
          <strong>{formatter(latest)}</strong>
        </div>
        <span className="muted">Dữ liệu lịch sử</span>
      </div>
      {segments.length ? (
        <svg
          className="infra-chart-svg"
          viewBox="0 0 600 160"
          role="img"
          aria-label={accessibleLabel}
        >
          <title>{accessibleLabel}</title>
          <line x1="0" y1="20" x2="600" y2="20" className="chart-grid-line" />
          <line x1="0" y1="80" x2="600" y2="80" className="chart-grid-line" />
          <line x1="0" y1="140" x2="600" y2="140" className="chart-grid-line" />
          {segments.map((segment, index) => (
            <polyline
              key={index}
              data-testid="chart-segment"
              points={segment.map(({ x, y }) => `${x},${y + 20}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : (
        <p className="infra-empty">Không có dữ liệu trong khoảng đã chọn</p>
      )}
      <p className="muted infra-chart-time">
        Cập nhật {new Date(history.collectedAt).toLocaleString('vi-VN')}
      </p>
    </article>
  );
}

export type { ChartMetric, InfrastructureHistoryPoint };
