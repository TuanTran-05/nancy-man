// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VariablesPage } from './VariablesPage.js';

const session = {
  userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
  username: 'ops-e2e',
  role: 'ops_readonly' as const,
  csrfToken: 'csrf-synthetic'
};

const inventory = {
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-08-31',
  generatedAt: '2026-08-31T12:00:00.000Z',
  items: [
    {
      catalogId: 'ops.api_database_url',
      name: 'DATABASE_URL',
      value: 'synthetic-secret-value',
      appId: 'ops',
      appName: 'Ops Console',
      functionIds: ['api.runtime'],
      sourceId: 'ops.api_env',
      sourcePathLabel: '/etc/edutrack-ops/api.env',
      sourceAdapter: 'systemd_environment_file',
      consumerIds: ['ops.api'],
      category: 'database',
      description: 'Synthetic variable for lifecycle tests.',
      sensitivity: 'secret',
      requirement: 'required',
      mutability: 'managed',
      applyStrategy: 'runtime_restart',
      relatedDefinitionIds: ['ops.api_database_url_duplicate'],
      precedence: { precedenceId: 'ops.runtime_env', rank: 200, effective: true },
      sourceFingerprint: 'hmac-sha256:v1:' + 'a'.repeat(64),
      valueFingerprint: 'hmac-sha256:v1:' + 'b'.repeat(64)
    }
  ]
};

const catalog = {
  catalogVersion: '2026-08-31',
  apps: [
    { id: 'ops', displayName: 'Ops Console', runtimeVariableCount: 47 },
    { id: 'website', displayName: 'Thien Uy Website', runtimeVariableCount: 0 }
  ]
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('VariablesPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function flushPromises() {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  }

  it('keeps inventory behind step-up, renders metadata and zero-variable apps, and locks locally', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/api/v1/auth/variables/unlock') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/api/v1/auth/variables/unlock')) {
        return jsonResponse({ unlockedUntil: '2099-08-31T12:10:00.000Z' });
      }
      if (url.endsWith('/api/v1/variables/catalog')) return jsonResponse(catalog);
      if (url.endsWith('/api/v1/variables')) return jsonResponse(inventory);
      throw new Error(`unexpected request ${url}`);
    });
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reportSpy = vi.fn();
    vi.stubGlobal('reportError', reportSpy);

    render(<VariablesPage session={session} onUnauthorized={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Mở khóa Variables' })).toBeInTheDocument();
    expect(calls.some(({ url }) => url.endsWith('/api/v1/variables'))).toBe(false);
    expect(screen.queryByText('synthetic-secret-value')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
      target: { value: 'synthetic-password' }
    });
    fireEvent.change(screen.getByLabelText('Mã TOTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mở khóa giá trị' }));

    expect(await screen.findByText('synthetic-secret-value')).toBeInTheDocument();
    const unlockCall = calls.find(
      ({ url, init }) => url.endsWith('/api/v1/auth/variables/unlock') && init?.method === 'POST'
    );
    expect(unlockCall?.init).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
      mode: 'same-origin',
      headers: expect.objectContaining({
        accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Ops-CSRF': 'csrf-synthetic'
      }),
      body: JSON.stringify({ password: 'synthetic-password', totpCode: '123456' })
    });
    const inventoryCall = calls.find(({ url }) => url.endsWith('/api/v1/variables'));
    expect(inventoryCall?.init).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
      mode: 'same-origin',
      headers: expect.objectContaining({ accept: 'application/json' })
    });
    expect(screen.getByRole('heading', { name: 'Thien Uy Website' })).toBeInTheDocument();
    expect(screen.getByText('Không có variables runtime')).toBeInTheDocument();
    expect(screen.getByText(/Trùng định nghĩa/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tìm variables'), { target: { value: 'DATABASE' } });
    expect(screen.getByText('synthetic-secret-value')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tìm variables'), {
      target: { value: 'does-not-exist' }
    });
    expect(screen.queryByText('synthetic-secret-value')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Khóa giá trị' }));
    expect(screen.queryByText('synthetic-secret-value')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Mở khóa Variables' })).toBeInTheDocument();
    expect(
      calls.some(
        ({ url, init }) =>
          url.endsWith('/api/v1/auth/variables/unlock') && init?.method === 'DELETE'
      )
    ).toBe(true);
    expect(storageSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('synthetic-secret-value'));
    expect(reportSpy).not.toHaveBeenCalled();
    expect(calls.map(({ url }) => url).join('\n')).not.toContain('synthetic-secret-value');
  });

  it('clears the page-local value at the server deadline and on a failed inventory refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00.000Z'));
    let inventoryReads = 0;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/variables/unlock') && init?.method === 'POST') {
        return jsonResponse({ unlockedUntil: '2026-08-31T12:00:10.000Z' });
      }
      if (url.endsWith('/api/v1/variables/catalog')) return jsonResponse(catalog);
      if (url.endsWith('/api/v1/variables')) {
        inventoryReads += 1;
        return inventoryReads === 1
          ? jsonResponse(inventory)
          : jsonResponse({ code: 'AGENT_DOWN' }, 503);
      }
      throw new Error(`unexpected request ${url}`);
    });
    render(<VariablesPage session={session} onUnauthorized={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
      target: { value: 'synthetic-password' }
    });
    fireEvent.change(screen.getByLabelText('Mã TOTP'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mở khóa giá trị' }));
      await flushPromises();
    });
    expect(screen.getByText('synthetic-secret-value')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
      await flushPromises();
    });
    expect(screen.queryByText('synthetic-secret-value')).not.toBeInTheDocument();

    // Unlock again so the deadline assertion proves the timer clears a visible value.
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
      target: { value: 'synthetic-password' }
    });
    fireEvent.change(screen.getByLabelText('Mã TOTP'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mở khóa giá trị' }));
      await flushPromises();
    });
    // The second inventory read fails, so the old value remains cleared and the gate returns.
    expect(screen.getByRole('heading', { name: 'Mở khóa Variables' })).toBeInTheDocument();

    // Restore a successful response for the expiry cycle.
    inventoryReads = 0;
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
      target: { value: 'synthetic-password' }
    });
    fireEvent.change(screen.getByLabelText('Mã TOTP'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mở khóa giá trị' }));
      await flushPromises();
    });
    expect(screen.getByText('synthetic-secret-value')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_001));
    expect(screen.queryByText('synthetic-secret-value')).not.toBeInTheDocument();
  });

  it('does not request inventory when the unlock deadline is already expired', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/api/v1/auth/variables/unlock')) {
        return jsonResponse({ unlockedUntil: new Date(Date.now() - 1_000).toISOString() });
      }
      throw new Error(`inventory must not be requested: ${url}`);
    });

    render(<VariablesPage session={session} onUnauthorized={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
      target: { value: 'synthetic-password' }
    });
    fireEvent.change(screen.getByLabelText('Mã TOTP'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mở khóa giá trị' }));
      await flushPromises();
    });

    expect(calls).toEqual(['POST /api/v1/auth/variables/unlock']);
    expect(screen.getByRole('heading', { name: 'Mở khóa Variables' })).toBeInTheDocument();
  });
});
