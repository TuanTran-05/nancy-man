// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';

afterEach(() => cleanup());

describe('dashboard shell', () => {
  it('completes anonymous bootstrap MFA from a fragment without requesting a session first', async () => {
    const originalUrl = window.location.href;
    const userId = 'f16f9426-010c-4e06-a459-9fd18c4a442d';
    const enrollmentToken = 'single-use-enrollment-token-1234567890';
    window.history.replaceState({}, '', `/bootstrap/mfa#token=${enrollmentToken}&userId=${userId}`);
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: init.body } : {})
      });
      if (url.endsWith('/api/v1/auth/bootstrap/totp/start')) {
        return new Response(
          JSON.stringify({
            factorId: 'd45ab6be-0fe4-4b64-a292-6f7c592c4d37',
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUri: 'otpauth://totp/EduTrack%20Operations:owner-id?secret=JBSWY3DPEHPK3PXP'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/v1/auth/bootstrap/totp/verify')) {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 401 });
      return new Response('{}', { status: 404 });
    };
    const user = userEvent.setup();

    try {
      render(<App />);
      expect(
        await screen.findByRole('heading', { name: 'Thiết lập xác thực hai lớp' })
      ).toBeInTheDocument();
      await waitFor(() => expect(window.location.hash).toBe(''));
      expect(calls).toEqual([]);

      await user.click(screen.getByRole('button', { name: 'Bắt đầu thiết lập MFA' }));
      expect(await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Mật khẩu mới'), 'Fresh-owner-password-2026!');
      await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'Fresh-owner-password-2026!');
      await user.type(screen.getByLabelText('Mã xác thực'), '123456');
      await user.click(screen.getByRole('button', { name: 'Kích hoạt tài khoản' }));

      expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
      expect(calls[0]).toMatchObject({
        url: '/api/v1/auth/bootstrap/totp/start',
        method: 'POST',
        body: JSON.stringify({ userId, token: enrollmentToken })
      });
      expect(calls[1]).toMatchObject({
        url: '/api/v1/auth/bootstrap/totp/verify',
        method: 'POST',
        body: JSON.stringify({
          userId,
          token: enrollmentToken,
          factorId: 'd45ab6be-0fe4-4b64-a292-6f7c592c4d37',
          otp: '123456',
          password: 'Fresh-owner-password-2026!'
        })
      });
      expect(calls.slice(0, 2).some((call) => call.url.endsWith('/auth/session'))).toBe(false);
    } finally {
      window.history.replaceState({}, '', originalUrl);
    }
  });

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

  it('mounts the read-only Variables workspace on the canonical route without reading values', async () => {
    const originalPath = window.location.pathname;
    window.history.replaceState({}, '', '/variables');
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/v1/auth/session')) {
        return new Response(
          JSON.stringify({
            userId: 'user-id',
            username: 'ops',
            role: 'ops_readonly',
            csrfToken: 'csrf-token'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    };

    try {
      render(<App />);
      expect(await screen.findByRole('heading', { name: 'Mở khóa Variables' })).toBeInTheDocument();
      expect(calls).toEqual(['/api/v1/auth/session']);
    } finally {
      window.history.replaceState({}, '', originalPath);
    }
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
