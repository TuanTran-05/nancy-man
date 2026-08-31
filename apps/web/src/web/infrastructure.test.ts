import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInfrastructureHistory } from './api.js';
import {
  formatBytes,
  formatLoad,
  formatPercent,
  formatRate,
  isInfrastructureUnavailable,
  makeLineSegments
} from './infrastructure.js';
import type { DashboardOverview, InfrastructureHistoryPoint } from '../shared/models.js';

afterEach(() => vi.restoreAllMocks());

const overview = (
  observedAt: string,
  level: 'healthy' | 'critical' = 'healthy'
): DashboardOverview => ({
  collectedAt: observedAt,
  latestByMonitor: {
    beszel: {
      monitor: 'beszel',
      level,
      observedAt,
      latencyMs: null,
      details: { probeOk: level === 'healthy' },
      errorCode: level === 'healthy' ? null : 'beszel_unavailable'
    },
    host_resources: {
      monitor: 'host_resources',
      level: 'healthy',
      observedAt,
      latencyMs: null,
      details: { cpuPercent: 42 },
      errorCode: null
    }
  },
  openIncidents: [],
  recentDeliveries: []
});

describe('infrastructure display helpers', () => {
  it('calls only the authenticated same-origin history path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          range: '24h',
          resolutionSeconds: 300,
          collectedAt: '2026-08-24T00:00:00.000Z',
          points: []
        }),
        { status: 200 }
      )
    );
    await getInfrastructureHistory('24h');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/monitoring/infrastructure/history?range=24h',
      expect.objectContaining({ credentials: 'same-origin' })
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/8090|pocketbase|beszel/i);
  });

  it('preserves unavailable/null semantics and formats with Vietnamese locale', () => {
    expect(formatPercent(null)).toBe('Không khả dụng');
    expect(formatPercent(42.56)).toBe('42,6%');
    expect(formatBytes(4 * 1024 ** 3)).toBe('4,00 GiB');
    expect(formatRate(1536)).toBe('1,50 KiB/s');
    expect(formatLoad(1.2)).toBe('1,20');
    expect(
      isInfrastructureUnavailable(
        overview('2026-08-24T00:00:46Z'),
        Date.parse('2026-08-24T00:03:17Z')
      )
    ).toBe(true);
    expect(
      isInfrastructureUnavailable(
        overview('2026-08-24T00:00:46Z'),
        Date.parse('2026-08-24T00:03:15Z')
      )
    ).toBe(false);
    expect(
      isInfrastructureUnavailable(
        overview('2026-08-24T00:00:46Z', 'critical'),
        Date.parse('2026-08-24T00:00:46Z')
      )
    ).toBe(true);
  });

  it('splits chart geometry at null points without producing invalid coordinates', () => {
    const points: InfrastructureHistoryPoint[] = [10, null, 30, 40].map((value, index) => ({
      observedAt: `2026-08-24T00:0${index}:00.000Z`,
      cpuPercent: value,
      memoryPercent: null,
      diskPercent: null,
      load1: null,
      networkReceiveBytesPerSecond: null,
      networkTransmitBytesPerSecond: null,
      diskReadBytesPerSecond: null,
      diskWriteBytesPerSecond: null
    }));
    const segments = makeLineSegments(points, 'cpuPercent', 600, 160);
    expect(segments).toHaveLength(2);
    expect(segments.flat().every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(
      true
    );
    expect(
      makeLineSegments(
        points.map((point) => ({ ...point, cpuPercent: null })),
        'cpuPercent',
        600,
        160
      )
    ).toEqual([]);
  });
});
