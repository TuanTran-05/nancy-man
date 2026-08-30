// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

describe('dashboard shell', () => {
  it('does not render destructive controls in the login shell', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.queryByText(/Restart|Chạy SQL/i)).not.toBeInTheDocument();
  });

  it('mounts infrastructure after overview and before monitor without destructive controls', async () => {
    const overview = {
      collectedAt: '2026-08-24T05:00:00.000Z',
      latestByMonitor: {
        beszel: {
          monitor: 'beszel',
          level: 'healthy',
          observedAt: '2026-08-24T05:00:00.000Z',
          latencyMs: 4,
          details: { systemId: 'abcdefghijklmno', probeOk: true },
          errorCode: null
        },
        host_resources: {
          monitor: 'host_resources',
          level: 'healthy',
          observedAt: '2026-08-24T05:00:00.000Z',
          latencyMs: 8,
          details: {
            cpuPercent: 42.5,
            memoryPercent: 61.2,
            memoryUsedBytes: 6442450944,
            memoryTotalBytes: 10737418240,
            swapUsedBytes: 0,
            swapTotalBytes: 2147483648,
            diskPercent: 48,
            diskUsedBytes: 51539607552,
            diskTotalBytes: 107374182400,
            networkReceiveBytesPerSecond: 1200,
            networkTransmitBytesPerSecond: 800,
            diskReadBytesPerSecond: 600,
            diskWriteBytesPerSecond: 300,
            load1: 1.2,
            load5: 0.9
          },
          errorCode: null
        },
        host_services: {
          monitor: 'host_services',
          level: 'healthy',
          observedAt: '2026-08-24T05:00:00.000Z',
          latencyMs: 8,
          details: {
            services: [
              {
                name: 'postgresql',
                state: 'active',
                subState: 'running',
                cpuPercent: 2,
                memoryBytes: 1048576
              }
            ]
          },
          errorCode: null
        }
      },
      openIncidents: [],
      recentDeliveries: []
    };
    const history = {
      range: '24h',
      resolutionSeconds: 300,
      collectedAt: '2026-08-24T05:00:00.000Z',
      points: [
        {
          observedAt: '2026-08-24T04:55:00.000Z',
          cpuPercent: 42.5,
          memoryPercent: 61.2,
          diskPercent: 48,
          load1: 1.2,
          networkReceiveBytesPerSecond: 1200,
          networkTransmitBytesPerSecond: 800,
          diskReadBytesPerSecond: 600,
          diskWriteBytesPerSecond: 300
        }
      ]
    };
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/session'))
        return new Response(
          JSON.stringify({
            username: 'ops',
            csrfToken: 'csrf',
            expiresAt: '2026-08-25T05:00:00.000Z'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      if (url.endsWith('/api/overview'))
        return new Response(JSON.stringify(overview), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      if (url.endsWith('/api/zalo/link'))
        return new Response(JSON.stringify({ linked: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      if (url.includes('/api/infrastructure/history'))
        return new Response(JSON.stringify(history), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      return new Response('{}', { status: 404 });
    };

    render(<App />);

    const infrastructure = await screen.findByRole('heading', { name: 'Hạ tầng VPS' });
    const overviewLabel = screen.getByText('Sự cố đang mở');
    const monitor = screen.getByRole('heading', { name: 'Monitor' });
    expect(
      overviewLabel.compareDocumentPosition(infrastructure) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      infrastructure.compareDocumentPosition(monitor) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.queryByText(/Beszel Hub|PocketBase|Restart|Terminal|Chạy SQL/i)
    ).not.toBeInTheDocument();
  });
});
