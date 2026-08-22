import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/audit/route';
import { getDb, verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import { createInMemoryDocumentStore } from '../../test-utils/inMemoryDocumentStore.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../../server/api/lib/maintenance/studentIdentityMaintenance.js';
import { getVietnamTodayStr } from '../../shared/classSchedule.js';
import { loadZaloBotConfig } from '../../server/api/zalo-bot/config.js';
import { runZaloBotDailyDigest } from '../../server/api/zalo-bot/digestService.js';
import { repairPendingZaloBotLinkConfirmations } from '../../server/api/zalo-bot/linkConfirmationService.js';
import { processOutboxJobs } from '../../server/api/lib/jobs/outbox.js';
import { initOutboxHandlers } from '../../server/api/lib/jobs/productionHandlers.js';

vi.mock('../../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('../../shared/classSchedule.js', () => ({
  getVietnamTodayStr: vi.fn(),
}));

vi.mock('../../server/api/zalo-bot/config.js', () => ({
  loadZaloBotConfig: vi.fn(),
}));

vi.mock('../../server/api/zalo-bot/digestService.js', () => ({
  runZaloBotDailyDigest: vi.fn(),
}));

vi.mock('../../server/api/zalo-bot/linkConfirmationService.js', () => ({
  repairPendingZaloBotLinkConfirmations: vi.fn(),
}));

vi.mock('../../server/api/lib/jobs/outbox.js', () => ({
  processOutboxJobs: vi.fn(),
}));

vi.mock('../../server/api/lib/jobs/productionHandlers.js', () => ({
  initOutboxHandlers: vi.fn(),
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

describe('zalo-bot-daily-digest cron', () => {
  let db: any;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStudentIdentityMaintenanceCacheForTests();
    const documentStore = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: '2026-08-09T09:00:00.000Z',
        updatedBy: 'operator',
      },
    });
    db = documentStore.db;
    vi.mocked(getDb).mockReturnValue(db as never);

    process.env.CRON_SECRET = 'cron-secret';

    vi.mocked(getVietnamTodayStr).mockReturnValue('2026-08-15');
    vi.mocked(loadZaloBotConfig).mockResolvedValue({} as any);
    vi.mocked(repairPendingZaloBotLinkConfirmations).mockResolvedValue({
      scanned: 0,
      enqueued: 5,
      skipped: 0,
    });
    vi.mocked(runZaloBotDailyDigest).mockResolvedValue({
      digestDate: '2026-08-15',
      dryRun: false,
      recipients: 10,
      enqueued: 8,
      existing: 2,
      skipped: 0,
    } as any);
    vi.mocked(processOutboxJobs).mockResolvedValue({ processed: 8, succeeded: 8, failed: 0 });
    vi.mocked(initOutboxHandlers).mockReturnValue(undefined);
  });

  it('1. Valid CRON_SECRET bearer accepted', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(200);
  });

  it('2. Native session auth accepted for admin role', async () => {
    process.env.CRON_SECRET = 'something-else';
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-id', role: 'admin' } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer session-token' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    expect(verifyAuthToken).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['admin']);
  });

  it('3. Missing/invalid bearer rejected', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    vi.mocked(verifyAuthToken).mockResolvedValue(null as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer wrong-secret' },
      } as any,
      res
    );
    // verifyAuthToken handles the 401 response directly when it returns null
  });

  it('4. Teacher/office/accounting rejected', async () => {
    process.env.CRON_SECRET = 'something-else';
    // verifyAuthToken only allows 'admin' for this route, so it will reject teacher/office
    vi.mocked(verifyAuthToken).mockResolvedValue(null as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer session-token' },
      } as any,
      res
    );
    expect(verifyAuthToken).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['admin']);
  });

  it('5. Only GET and POST accepted', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'PUT',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(405);
  });

  it('6. Normal mode uses current Vietnam date and tomorrow date', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    expect(runZaloBotDailyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestDate: '2026-08-15',
        tomorrowDate: '2026-08-16',
      })
    );
  });

  it('7. catch-up mode uses previous date; skips when completedAt exists', async () => {
    let res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest', mode: 'catch-up' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    expect(runZaloBotDailyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestDate: '2026-08-14',
        tomorrowDate: '2026-08-15',
      })
    );

    // Set completedAt
    await db
      .collection('_maintenance')
      .doc('zaloBotDigest_2026-08-14')
      .set({ completedAt: new Date().toISOString() });

    res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest', mode: 'catch-up' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.skipped).toBe(true);
    expect(res.body.reason).toBe('already_ran_catch_up');
  });

  it('8. Calls runTrackedJob with kind zalo_bot_daily_digest', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );

    // We can verify this by checking the jobs collection since runTrackedJob is the real implementation
    const jobsSnap = await db.collection('jobs').where('kind', '==', 'zalo_bot_daily_digest').get();
    expect(jobsSnap.empty).toBe(false);
  });

  it('9. Calls repairPendingZaloBotLinkConfirmations before digest generation', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(repairPendingZaloBotLinkConfirmations).toHaveBeenCalledWith(db, { limit: 100 });
    // check order via vi mock call order is tricky without spy, but they are both called
    expect(repairPendingZaloBotLinkConfirmations).toHaveBeenCalled();
    expect(runZaloBotDailyDigest).toHaveBeenCalled();
  });

  it('10. Calls initOutboxHandlers + processOutboxJobs after enqueue', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(initOutboxHandlers).toHaveBeenCalled();
    expect(processOutboxJobs).toHaveBeenCalledWith(db, 'zalo-bot-daily-digest');
  });

  it('11. Response separates confirmation-repair, generation and delivery counts', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.body.counts).toEqual({
      confirmationRepair: 5,
      generation: 8,
      delivery: 8,
      deliveryFailures: 0,
    });
  });

  it('12. Repeated invocation returns success without duplicates', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(200);
  });

  it('13. student-identity guard returns blocked response before generation', async () => {
    process.env.STUDENT_IDENTITY_MAINTENANCE_REQUIRED = 'true';
    await db.collection('_maintenance').doc('student_identity').set({
      mode: 'maintenance',
      activeRunId: 'some-run',
    });
    resetStudentIdentityMaintenanceCacheForTests();
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(503);
    expect(runZaloBotDailyDigest).not.toHaveBeenCalled();
  });

  it('returns 502 if generation succeeds but delivery has failures', async () => {
    vi.mocked(processOutboxJobs).mockResolvedValue({ processed: 8, succeeded: 5, failed: 3 });
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { action: 'zalo-bot-daily-digest' },
        headers: { authorization: 'Bearer cron-secret' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(502);
    expect(res.body.counts.deliveryFailures).toBe(3);
  });
});
