import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../server/api/audit/route';
import { getDb } from '../server/api/lib/auth/verifyAuth.js';
import {
  getCoreEnvironmentReadiness,
  getProductionEnvironmentReadiness,
} from '../server/api/lib/validation/validateEnv.js';
import { checkSqlConnection } from '../server/db/client.js';

vi.mock('../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('../server/api/lib/validation/validateEnv.js', () => ({
  getCoreEnvironmentReadiness: vi.fn(() => ({ ready: true, missing: [] })),
  getProductionEnvironmentReadiness: vi.fn(() => ({ ready: true, missing: [] })),
}));

vi.mock('../server/db/client.js', () => ({
  checkSqlConnection: vi.fn(),
}));

function mockRes() {
  const res: any = {};
  res.setHeader = vi.fn();
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end = vi.fn();
  return res;
}

describe('GET /api/v1/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCoreEnvironmentReadiness).mockReturnValue({ ready: true, missing: [] });
    vi.mocked(getProductionEnvironmentReadiness).mockReturnValue({ ready: true, missing: [] });
    vi.mocked(checkSqlConnection).mockResolvedValue({
      database: 'edutrack',
      user: 'edutrack',
      serverVersion: 'PostgreSQL 16',
    });
  });

  it('returns ok when PostgreSQL is reachable', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'health' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
    expect(res.body.checks).toEqual({ postgres: 'connected' });
  });

  it('returns degraded when PostgreSQL is unavailable', async () => {
    vi.mocked(checkSqlConnection).mockRejectedValue(new Error('down'));

    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'health' } } as any, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      status: 'degraded',
      checks: { postgres: 'unavailable' },
    });
  });

  it('returns degraded without opening PostgreSQL when core configuration is missing', async () => {
    vi.mocked(getCoreEnvironmentReadiness).mockReturnValue({
      ready: false,
      missing: ['DATABASE_URL'],
    });

    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'health' } } as any, res);

    expect(getDb).not.toHaveBeenCalled();
    expect(checkSqlConnection).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, status: 'degraded' });
    expect(res.body).not.toHaveProperty('missing');
  });

  it('returns sanitized missing production secret keys without opening PostgreSQL', async () => {
    vi.mocked(getProductionEnvironmentReadiness).mockReturnValue({
      ready: false,
      missing: ['LOOKUP_CHALLENGE_SECRET'],
    });

    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'health' } } as any, res);

    expect(getDb).not.toHaveBeenCalled();
    expect(checkSqlConnection).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      status: 'degraded',
      missingEnv: ['LOOKUP_CHALLENGE_SECRET'],
    });
    expect(JSON.stringify(res.body)).not.toContain('lookup-secret');
  });
});

describe('GET /api/v1/liveness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not initialize either data backend', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'liveness' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'ok', service: 'edutrack-api' });
    expect(getDb).not.toHaveBeenCalled();
    expect(checkSqlConnection).not.toHaveBeenCalled();
  });
});
