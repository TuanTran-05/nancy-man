// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverviewCards } from './OverviewCards.js';
import type { DashboardOverview } from '../../shared/models.js';

const healthyOverview: DashboardOverview = {
  collectedAt: '2026-08-22T00:00:00Z',
  latestByMonitor: {
    app_liveness: {
      monitor: 'app_liveness',
      level: 'healthy',
      observedAt: '2026-08-22T00:00:00Z',
      latencyMs: 2,
      details: {},
      errorCode: null
    }
  },
  openIncidents: [],
  recentDeliveries: []
};

describe('overview cards', () => {
  it('renders stale state instead of presenting an old healthy sample as current', () => {
    render(
      <OverviewCards overview={{ ...healthyOverview, collectedAt: '2020-01-01T00:00:00Z' }} />
    );
    expect(screen.getByText(/Dữ liệu cũ/i)).toBeInTheDocument();
  });
});
