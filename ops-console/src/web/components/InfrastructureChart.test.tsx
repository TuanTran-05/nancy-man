// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { InfrastructureHistoryResponse } from '../../shared/models.js';
import { formatPercent } from '../infrastructure.js';
import { InfrastructureChart } from './InfrastructureChart.js';

const history: InfrastructureHistoryResponse = {
  range: '24h', resolutionSeconds: 300, collectedAt: '2026-08-24T00:00:00.000Z',
  points: [10, null, 30, 42.5].map((cpuPercent, index) => ({ observedAt: `2026-08-24T00:0${index}:00.000Z`, cpuPercent, memoryPercent: null, diskPercent: null, load1: null, networkReceiveBytesPerSecond: null, networkTransmitBytesPerSecond: null, diskReadBytesPerSecond: null, diskWriteBytesPerSecond: null })),
};

describe('InfrastructureChart', () => {
  it('has an accessible name, renders null gaps and the latest formatted value', () => {
    render(<InfrastructureChart history={history} metric="cpuPercent" label="CPU" color="#67e8f9" formatter={formatPercent} />);
    expect(screen.getByRole('img', { name: /CPU trong 24 giờ/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('chart-segment')).toHaveLength(2);
    expect(screen.getByText('42,5%')).toBeInTheDocument();
    expect(screen.getByText(/Cập nhật/)).toBeInTheDocument();
  });

  it('shows a bounded empty state for all-null data without invalid SVG values', () => {
    const empty = { ...history, points: history.points.map((point) => ({ ...point, cpuPercent: null })) };
    const { container } = render(<InfrastructureChart history={empty} metric="cpuPercent" label="CPU" color="#67e8f9" formatter={formatPercent} />);
    expect(screen.getByText('Không có dữ liệu trong khoảng đã chọn')).toBeInTheDocument();
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity|null/);
  });
});
