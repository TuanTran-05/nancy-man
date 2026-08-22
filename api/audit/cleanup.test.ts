import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/audit/route';
import { getDb } from '../../server/api/lib/auth/verifyAuth.js';

vi.mock('../../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
  setCorsHeaders: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
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
    query: { action: 'cleanup' },
  } as any;
}

function createSnapshot(collectionName: string, size: number) {
  return {
    empty: size === 0,
    size,
    docs: Array.from({ length: size }, (_, index) => ({
      ref: { path: `${collectionName}/${index}` },
    })),
  };
}

function createQuery(collectionName: string, sizes: number[] = [0]) {
  const remainingSizes = [...sizes];
  const query: any = {};
  query.where = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.get = vi.fn(async () =>
    createSnapshot(collectionName, remainingSizes.length ? remainingSizes.shift()! : 0)
  );
  return query;
}

function mockCleanupDb(options?: {
  collectionSizes?: Record<string, number[]>;
  marker?: { exists: boolean; data?: Record<string, unknown> };
}) {
  const collections: Record<string, any> = {};
  const batch = {
    delete: vi.fn(),
    commit: vi.fn(),
  };
  const markerRef = {
    get: vi.fn(async () => ({
      exists: options?.marker?.exists ?? false,
      data: () => options?.marker?.data ?? {},
    })),
    set: vi.fn(),
  };
  const maintenanceCollection = {
    doc: vi.fn(() => markerRef),
  };
  const db = {
    batch: vi.fn(() => batch),
    collection: vi.fn((name: string) => {
      if (name === '_maintenance') return maintenanceCollection;
      if (!collections[name])
        collections[name] = createQuery(name, options?.collectionSizes?.[name]);
      return collections[name];
    }),
  };

  return { db, batch, collections, markerRef };
}

describe('GET /api/maintenance/cleanup', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it('rejects cron_secret query parameter authorization', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'cleanup', cron_secret: 'test-cron-secret' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('retains webhook evidence while deleting old in-app notifications during cron cleanup', async () => {
    vi.setSystemTime(new Date('2026-05-12T16:00:00.000Z'));
    const { db, batch, collections } = mockCleanupDb({
      collectionSizes: {
        webhook_events: [0],
        notifications: [2],
      },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(cronReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.deleted).toMatchObject({
      webhookEvents: 0,
      notifications: 2,
    });
    expect(collections.webhook_events.where).toHaveBeenCalledWith(
      'updatedAt',
      '<',
      expect.any(String)
    );
    expect(collections.notifications.where).toHaveBeenCalledWith(
      'createdAt',
      '<',
      expect.any(String)
    );
    const webhookCutoff = collections.webhook_events.where.mock.calls.find(
      (call: unknown[]) => call[0] === 'updatedAt'
    )?.[2] as string;
    expect(new Date(webhookCutoff).getFullYear()).toBe(2019);
    expect(batch.delete).toHaveBeenCalledTimes(2);
  });

  it('uses the dedicated retention window for admin read audits', async () => {
    vi.setSystemTime(new Date('2026-05-12T18:00:00.000Z'));
    const { db, batch, collections, markerRef } = mockCleanupDb({
      collectionSizes: { audit_logs: [2, 0] },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(cronReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.deleted.auditLogs).toBe(2);
    expect(res.body.auditLogCleanup).toMatchObject({
      eligible: true,
      alreadyRan: false,
      completed: true,
      monthKey: '2026-05',
      dayOfMonth: 13,
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(collections.audit_logs.get).toHaveBeenCalledTimes(3);
    const auditCutoffs = collections.audit_logs.where.mock.calls
      .filter((call: unknown[]) => call[0] === 'timestamp')
      .map((call: unknown[]) => call[2] as string);
    expect(auditCutoffs).toEqual([
      '2026-03-13T18:00:00.000Z',
      '2026-03-13T18:00:00.000Z',
      '2026-02-11T18:00:00.000Z',
    ]);
    expect(batch.delete).toHaveBeenCalledTimes(2);
    expect(markerRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRunMonth: '2026-05',
        deletedCount: 2,
        timeZone: 'Asia/Ho_Chi_Minh',
      }),
      { merge: true }
    );
  });

  it('does not touch audit logs before the 13th in Vietnam', async () => {
    vi.setSystemTime(new Date('2026-05-12T16:00:00.000Z'));
    const { db, markerRef } = mockCleanupDb();
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(cronReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.deleted.auditLogs).toBe(0);
    expect(res.body.auditLogCleanup).toMatchObject({
      eligible: false,
      monthKey: '2026-05',
      dayOfMonth: 12,
    });
    expect(db.collection).not.toHaveBeenCalledWith('audit_logs');
    expect(markerRef.get).not.toHaveBeenCalled();
  });

  it('skips audit cleanup after the monthly marker has been recorded', async () => {
    vi.setSystemTime(new Date('2026-05-13T18:00:00.000Z'));
    const { db, markerRef } = mockCleanupDb({
      marker: { exists: true, data: { lastRunMonth: '2026-05' } },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(cronReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.deleted.auditLogs).toBe(0);
    expect(res.body.auditLogCleanup).toMatchObject({
      eligible: true,
      alreadyRan: true,
      monthKey: '2026-05',
      dayOfMonth: 14,
    });
    expect(db.collection).not.toHaveBeenCalledWith('audit_logs');
    expect(markerRef.set).not.toHaveBeenCalled();
  });

  it('deletes expired Zalo chat sessions during daily cleanup', async () => {
    vi.setSystemTime(new Date('2026-08-16T18:00:00.000Z'));
    const { db, collections } = mockCleanupDb({
      collectionSizes: { zalo_bot_chat_sessions: [2] },
    });
    vi.mocked(getDb).mockReturnValue(db as any);

    const res = mockRes();
    await handler(cronReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.deleted.zaloBotChatSessions).toBe(2);
    expect(collections.zalo_bot_chat_sessions.where).toHaveBeenCalledWith(
      'expiresAt',
      '<',
      '2026-08-16T18:00:00.000Z'
    );
  });
});
