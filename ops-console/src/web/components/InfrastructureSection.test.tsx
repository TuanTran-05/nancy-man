// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DashboardOverview, InfrastructureHistoryResponse } from '../../shared/models.js';
import { InfrastructureSection } from './InfrastructureSection.js';

const history = (range: InfrastructureHistoryResponse['range'] = '24h'): InfrastructureHistoryResponse => ({ range, resolutionSeconds: range === '24h' ? 300 : 1800, collectedAt: '2026-08-24T00:00:00.000Z', points: [{ observedAt: '2026-08-24T00:00:00.000Z', cpuPercent: 42.5, memoryPercent: 50, diskPercent: 50, load1: 1.2, networkReceiveBytesPerSecond: 8192, networkTransmitBytesPerSecond: 4096, diskReadBytesPerSecond: 1048576, diskWriteBytesPerSecond: 2097152 }] });
const makeOverview = (observedAt = '2026-08-24T00:00:00.000Z', stale = false): DashboardOverview => ({
  collectedAt: observedAt,
  latestByMonitor: {
    beszel: { monitor: 'beszel', level: stale ? 'critical' : 'healthy', observedAt, latencyMs: null, details: { probeOk: !stale, hubVersion: '0.18.8', systemStatus: stale ? 'down' : 'up' }, errorCode: stale ? 'beszel_unavailable' : null },
    host_resources: { monitor: 'host_resources', level: 'healthy', observedAt, latencyMs: null, details: stale ? { cpuPercent: 42.5 } : { cpuPercent: 42.5, memoryPercent: 50, memoryUsedBytes: 4 * 1024 ** 3, memoryTotalBytes: 8 * 1024 ** 3, swapPercent: 25, swapUsedBytes: 0.5 * 1024 ** 3, swapTotalBytes: 2 * 1024 ** 3, load1: 1.2, load5: 0.8, diskPercent: 50, diskUsedBytes: 24 * 1024 ** 3, diskTotalBytes: 48 * 1024 ** 3, diskReadBytesPerSecond: 1048576, diskWriteBytesPerSecond: 2097152, diskIoUtilizationPercent: 3, networkReceiveBytesPerSecond: 8192, networkTransmitBytesPerSecond: 4096 } as Record<string, unknown>, errorCode: null },
    host_services: { monitor: 'host_services', level: 'healthy', observedAt, latencyMs: null, details: { services: [{ name: 'nginx', state: 'active', subState: 'running', cpuPercent: 0.3, memoryBytes: 33554432, observedAt }, { name: 'postgresql', state: 'failed', subState: 'failed', cpuPercent: 2.1, memoryBytes: 134217728, observedAt }] }, errorCode: null },
  }, openIncidents: [], recentDeliveries: [],
});

describe('InfrastructureSection', () => {
  it('renders current cards, four charts, accessible ranges and failed services first', async () => {
    const loadHistory = vi.fn(async (range: InfrastructureHistoryResponse['range']) => history(range));
    render(<InfrastructureSection overview={makeOverview()} now={Date.parse('2026-08-24T00:01:00Z')} loadHistory={loadHistory} />);
    expect(screen.getByRole('heading', { name: 'Hạ tầng VPS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
    expect(loadHistory).toHaveBeenCalledWith('24h');
    expect(await screen.findAllByTestId('chart-segment')).toHaveLength(4);
    expect(screen.getAllByTestId('service-row').map((node) => node.textContent)).toEqual([expect.stringContaining('postgresql'), expect.stringContaining('nginx')]);
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true'));
    expect(loadHistory).toHaveBeenCalledWith('7d');
  });

  it('hides stale current values, keeps history visible and handles failed/null history', async () => {
    const loadHistory = vi.fn(async () => history());
    const first = render(<InfrastructureSection overview={makeOverview('2026-08-23T23:58:29Z', true)} now={Date.parse('2026-08-24T00:01:00Z')} loadHistory={loadHistory} />);
    expect(screen.getByText('Telemetry hạ tầng không khả dụng')).toBeInTheDocument();
    expect(screen.getAllByText('Không khả dụng').length).toBeGreaterThan(0);
    expect(first.container.querySelector('.infra-metric-card')?.textContent).not.toContain('42,5%');
    expect(await screen.findAllByTestId('chart-segment')).toHaveLength(4);
    first.unmount();

    const failed = vi.fn(async () => { throw new Error('history failed'); });
    render(<InfrastructureSection overview={makeOverview()} now={Date.parse('2026-08-24T00:01:00Z')} loadHistory={failed} />);
    expect(await screen.findByText('Không tải được lịch sử hạ tầng.')).toBeInTheDocument();
    expect(screen.getAllByText('42,5%').length).toBeGreaterThan(0);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
