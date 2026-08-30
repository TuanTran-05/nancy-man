import type {
  DashboardOverview,
  InfrastructureHistoryPoint,
  MonitorSample
} from '../shared/models.js';

const unavailable = 'Không khả dụng';
const numberFormat = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});
const bytesFormat = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const loadFormat = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const validNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function formatPercent(value: number | null): string {
  return validNumber(value) && value >= 0 ? `${numberFormat.format(value)}%` : unavailable;
}

export function formatBytes(value: number | null): string {
  if (!validNumber(value) || value < 0) return unavailable;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${bytesFormat.format(scaled)} ${units[unit]}`;
}

export function formatRate(value: number | null): string {
  const formatted = formatBytes(value);
  return formatted === unavailable ? unavailable : `${formatted}/s`;
}

export function formatLoad(value: number | null): string {
  return validNumber(value) && value >= 0 ? loadFormat.format(value) : unavailable;
}

export function isInfrastructureUnavailable(
  overview: DashboardOverview,
  now = Date.now()
): boolean {
  const beszel = overview.latestByMonitor.beszel;
  const resources = overview.latestByMonitor.host_resources;
  if (!beszel || beszel.level !== 'healthy' || beszel.details.probeOk !== true || !resources)
    return true;
  const observedAt = Date.parse(resources.observedAt);
  return !Number.isFinite(observedAt) || now - observedAt > 150_000;
}

export type ChartMetric = keyof Pick<
  InfrastructureHistoryPoint,
  | 'cpuPercent'
  | 'memoryPercent'
  | 'diskPercent'
  | 'load1'
  | 'networkReceiveBytesPerSecond'
  | 'networkTransmitBytesPerSecond'
  | 'diskReadBytesPerSecond'
  | 'diskWriteBytesPerSecond'
>;
export interface ChartPoint {
  x: number;
  y: number;
  value: number;
}

export function makeLineSegments(
  points: InfrastructureHistoryPoint[],
  metric: ChartMetric,
  width: number,
  height: number
): ChartPoint[][] {
  const values = points.map((point) => point[metric]).filter(validNumber);
  if (!values.length || width <= 0 || height <= 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const xFor = (index: number): number =>
    points.length <= 1 ? width / 2 : (index / (points.length - 1)) * width;
  const yFor = (value: number): number =>
    span === 0 ? height / 2 : height - ((value - min) / span) * height;
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  points.forEach((point, index) => {
    const value = point[metric];
    if (!validNumber(value)) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: xFor(index), y: yFor(value), value });
  });
  if (current.length) segments.push(current);
  return segments;
}

export function resourceDetails(sample: MonitorSample | undefined): Record<string, unknown> {
  return sample?.details ?? {};
}
