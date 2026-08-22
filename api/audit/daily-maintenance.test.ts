import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/audit/route';
import { getDb } from '../../server/api/lib/auth/verifyAuth.js';
import {
  createInMemoryDocumentStore,
  type DocumentStoreDocumentData,
} from '../../test-utils/inMemoryDocumentStore.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../../server/api/lib/maintenance/studentIdentityMaintenance.js';

vi.mock('../../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('daily maintenance cron', () => {
  let store: Map<string, DocumentStoreDocumentData>;

  beforeEach(() => {
    resetStudentIdentityMaintenanceCacheForTests();
    // The cron fans out into student-mutating endpoints, so it now passes the
    // same maintenance guard they do and needs a real state to read.
    const memory = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: '2026-08-09T09:00:00.000Z',
        updatedBy: 'operator',
      },
    });
    store = memory.store;
    vi.mocked(getDb).mockReturnValue(memory.db as never);
    process.env.CRON_SECRET = 'cron-secret';
    process.env.PAYOS_ENABLED = 'true';
    process.env.PAYOS_CLIENT_ID = 'payos-client';
    process.env.PAYOS_API_KEY = 'payos-api-key';
    process.env.PAYOS_CHECKSUM_KEY = 'payos-checksum';
    // The handler prefers this over the request headers, so the host the test
    // controls only decides the fan-out origin while it stays unset.
    delete process.env.INTERNAL_API_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('{}') })
    );
  });

  it('runs every daily job through the existing protected endpoints', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'daily-maintenance' },
        headers: { authorization: 'Bearer cron-secret', host: 'vps.thienuy.edu.vn' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(9);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        'https://vps.thienuy.edu.vn/api/audit/cleanup',
        'https://vps.thienuy.edu.vn/api/audit/finance-aggregate',
        'https://vps.thienuy.edu.vn/api/audit/dashboard-aggregate',
        'https://vps.thienuy.edu.vn/api/audit/notification-digest',
        'https://vps.thienuy.edu.vn/api/audit/outbox-process',
        'https://vps.thienuy.edu.vn/api/v1/payments/payos/reconcile',
        'https://vps.thienuy.edu.vn/api/audit/zalo-bot-daily-digest?mode=catch-up',
        'https://vps.thienuy.edu.vn/api/audit/admin-class-tuition-rebuild',
        // Added once, after the aggregates it reports on, so a green day
        // reflects the projections as they were left rather than as found.
        'https://vps.thienuy.edu.vn/api/audit/student-identity-health',
      ])
    );
  });

  it('skips PayOS reconciliation while the integration is deferred', async () => {
    process.env.PAYOS_ENABLED = 'false';
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        query: { action: 'daily-maintenance' },
        headers: { authorization: 'Bearer cron-secret', host: 'vps.thienuy.edu.vn' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(8);
    expect(urls).not.toContain('https://vps.thienuy.edu.vn/api/v1/payments/payos/reconcile');
  });

  // This cron was the only one in the file that recorded nothing. It stopped
  // firing on 2026-07-18 and the silence was indistinguishable from a healthy
  // no-op for a month, because a run that dies leaves the same empty database
  // as a run that never happened.
  it('records a completed run so a healthy day is visible in job_runs', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'daily-maintenance' },
        headers: { authorization: 'Bearer cron-secret', host: 'vps.thienuy.edu.vn' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(store.get('job_runs/daily-maintenance')).toMatchObject({
      jobName: 'daily-maintenance',
      status: 'success',
    });
  });

  it('uses PUBLIC_BASE_URL for self-calls on a VPS', async () => {
    process.env.PUBLIC_BASE_URL = 'https://vps.thienuy.edu.vn/base/';
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        query: { action: 'daily-maintenance' },
        headers: { authorization: 'Bearer cron-secret', host: '127.0.0.1:3000' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'https://vps.thienuy.edu.vn/base/api/audit/cleanup'
    );
  });

  it('prefers INTERNAL_API_BASE_URL so VPS self-calls stay on loopback', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://127.0.0.1:3000/';
    process.env.PUBLIC_BASE_URL = 'https://vps.thienuy.edu.vn';
    const res = mockRes();

    await handler(
      {
        method: 'GET',
        query: { action: 'daily-maintenance' },
        headers: { authorization: 'Bearer cron-secret', host: 'vps.thienuy.edu.vn' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'http://127.0.0.1:3000/api/audit/cleanup'
    );
  });

  it('records a fan-out failure as a failed run naming the jobs that broke', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, text: vi.fn().mockResolvedValue('boom') })
        .mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('{}') })
    );
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'daily-maintenance' },
        headers: { authorization: 'Bearer cron-secret', host: 'vps.thienuy.edu.vn' },
      } as any,
      res
    );

    // The response contract is unchanged: a partial fan-out is still a 502.
    expect(res.statusCode).toBe(502);
    const run = store.get('job_runs/daily-maintenance') as Record<string, unknown>;
    expect(run).toMatchObject({ jobName: 'daily-maintenance', status: 'failed' });
    expect(String(run.errorMessage)).toContain('cleanup');
  });

  it('records the run before resolving the host, so an unresolvable host leaves evidence', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'daily-maintenance' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get('job_runs/daily-maintenance')).toMatchObject({
      jobName: 'daily-maintenance',
      status: 'failed',
    });
  });
});
