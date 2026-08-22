import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/audit/route';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { processOutboxJobs } from '../../server/api/lib/jobs/outbox.js';
import { initOutboxHandlers } from '../../server/api/lib/jobs/productionHandlers.js';
import { createInMemoryDocumentStore } from '../../test-utils/inMemoryDocumentStore.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../../server/api/lib/maintenance/studentIdentityMaintenance.js';

vi.mock('../../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
  setCorsHeaders: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('../../server/api/lib/jobs/outbox.js', () => ({
  processOutboxJobs: vi.fn().mockResolvedValue({ processed: 2, succeeded: 2, failed: 0 }),
}));

vi.mock('../../server/api/lib/jobs/productionHandlers.js', () => ({
  initOutboxHandlers: vi.fn(),
}));

function mockRes() {
  const res: any = { statusCode: 200 };
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

function cronReq() {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer test-cron-secret' },
    query: { action: 'outbox-process' },
  } as any;
}

describe('GET /api/v1/audit/outbox-process', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStudentIdentityMaintenanceCacheForTests();
    process.env.CRON_SECRET = 'test-cron-secret';
    vi.mocked(verifyAuthToken).mockImplementation(async (req: any, res: any) => {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return null;
    });
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it('runs outbox processing and returns stats when authorized via cron header', async () => {
    const db = {};
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(cronReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, processed: 2, succeeded: 2, failed: 0 });
    expect(initOutboxHandlers).toHaveBeenCalledTimes(1);
    expect(processOutboxJobs).toHaveBeenCalledWith(db, 'vps-cron');
  });

  it('rejects unauthorized requests', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'outbox-process' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(401);
    expect(processOutboxJobs).not.toHaveBeenCalled();
  });

  it('refuses an authorized scheduled GET before outbox processing during maintenance', async () => {
    const { db } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'read_only',
        activeRunId: 'run-1',
        migrationActorId: 'migration',
        updatedAt: '2026-08-09T09:00:00.000Z',
        updatedBy: 'operator',
      },
    });
    vi.mocked(getDb).mockReturnValue(db as never);

    const res = mockRes();
    await handler(cronReq(), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'STUDENT_IDENTITY_MAINTENANCE',
    });
    expect(initOutboxHandlers).not.toHaveBeenCalled();
    expect(processOutboxJobs).not.toHaveBeenCalled();
  });
});
