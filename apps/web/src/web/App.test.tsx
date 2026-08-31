// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';

describe('dashboard shell', () => {
  it('uses canonical two-step login and never posts a legacy session request', async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 401 });
      if (url.endsWith('/api/v1/auth/login')) {
        return new Response(
          JSON.stringify({
            status: 'mfa_required',
            mfaChallenge: 'c'.repeat(32),
            factors: [{ id: 'f16f9426-010c-4e06-a459-9fd18c4a442d', type: 'totp', label: 'App' }]
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/v1/auth/login/totp')) {
        return new Response(
          JSON.stringify({
            userId: 'user-id',
            username: 'tuan.dev',
            displayName: 'Tuan Dev',
            role: 'ops_owner',
            csrfToken: 'csrf-token',
            expiresAt: '2026-08-31T13:00:00.000Z'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    };
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Tên đăng nhập'), 'tuan.dev');
    await user.type(screen.getByLabelText('Mật khẩu'), 'a-long-new-password');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByLabelText('Mã xác thực')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mã xác thực'), '123456');
    await user.click(screen.getByRole('button', { name: 'Hoàn tất đăng nhập' }));
    expect(await screen.findByText('Tổng quan')).toBeInTheDocument();
    expect(calls.some((call) => call.includes('/api/session'))).toBe(false);
  });

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
      if (url.endsWith('/api/v1/auth/session'))
        return new Response(
          JSON.stringify({
            userId: 'user-id',
            username: 'ops',
            csrfToken: 'csrf',
            role: 'ops_owner',
            expiresAt: '2026-08-25T05:00:00.000Z'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      if (url.endsWith('/api/v1/monitoring/overview'))
        return new Response(JSON.stringify(overview), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      if (url.endsWith('/api/v1/zalo/link'))
        return new Response(JSON.stringify({ linked: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      if (url.includes('/api/v1/monitoring/infrastructure/history'))
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
