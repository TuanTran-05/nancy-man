import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dispatchZaloBotSelfAction,
  dispatchZaloBotAdminAction,
  generateZaloBotLinkCode,
} from './linkHandlers';
import { loadZaloBotConfig } from './config';
import { getDb } from '../lib/auth/verifyAuth';
import * as linkRepo from './linkRepository';
import * as auditLog from '../lib/logging/auditLog';
import { createOutboxJob } from '../lib/jobs/outbox';
import { createZaloBotMessageIfAbsent } from './messageRepository';

vi.mock('./config');
vi.mock('../lib/auth/verifyAuth');
vi.mock('./linkRepository');
vi.mock('../lib/logging/auditLog');
vi.mock('../lib/jobs/outbox');
vi.mock('./messageRepository');

describe('Zalo Bot Link Handlers', () => {
  let req: any;
  let res: any;
  let mockDb: any;
  let context: any;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadZaloBotConfig).mockReturnValue({
      enabled: true,
      webhookSecret: 'test-secret',
    } as any);

    mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ exists: false }),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as any);

    req = { method: 'POST', body: {} };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    context = { uid: 'u1', role: 'teacher', name: 'Teacher One' };
  });

  it('generates an eight-character uppercase alphanumeric one-time code', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(generateZaloBotLinkCode()).toMatch(/^[A-Z0-9]{8}$/);
    }
  });

  describe('dispatchZaloBotSelfAction', () => {
    it('my-link returns 200 with botEnabled and link info', async () => {
      req.method = 'GET';
      const linkData = { chatId: 'c1', status: 'active' };
      mockDb.get.mockResolvedValueOnce({ exists: true, data: () => linkData });

      await dispatchZaloBotSelfAction('my-link', req, res, context);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        botEnabled: true,
        link: { status: 'active' }, // chatId removed
      });
    });

    it('create-link-code returns 503 when botEnabled is false', async () => {
      vi.mocked(loadZaloBotConfig).mockReturnValueOnce({ enabled: false } as any);
      await dispatchZaloBotSelfAction('create-link-code', req, res, context);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ success: false, errorCode: 'zalo_bot_disabled' });
    });

    it('unlink returns 503 when botEnabled is false', async () => {
      vi.mocked(loadZaloBotConfig).mockReturnValueOnce({ enabled: false } as any);
      await dispatchZaloBotSelfAction('unlink', req, res, context);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ success: false, errorCode: 'zalo_bot_disabled' });
    });
  });

  describe('dispatchZaloBotAdminAction', () => {
    beforeEach(() => {
      context.role = 'admin';
    });

    it('admin-link returns 503 when botEnabled is false', async () => {
      vi.mocked(loadZaloBotConfig).mockReturnValueOnce({ enabled: false } as any);
      await dispatchZaloBotAdminAction('admin-link', req, res, context);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ success: false, errorCode: 'zalo_bot_disabled' });
    });

    it('admin-unlink returns 503 when botEnabled is false', async () => {
      vi.mocked(loadZaloBotConfig).mockReturnValueOnce({ enabled: false } as any);
      await dispatchZaloBotAdminAction('admin-unlink', req, res, context);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ success: false, errorCode: 'zalo_bot_disabled' });
    });

    it('admin-link rejects an ineligible target role before creating a link', async () => {
      req.body = { staffId: 'student-1', chatIdHash: 'hash-1' };
      mockDb.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ role: 'student', displayName: 'Student One' }),
      });

      await dispatchZaloBotAdminAction('admin-link', req, res, context);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Ineligible role' });
      expect(linkRepo.adminLinkZaloBotChat).not.toHaveBeenCalled();
    });

    it('admin-overview returns combined data', async () => {
      req.method = 'GET';
      mockDb.get
        .mockResolvedValueOnce({
          docs: [{ id: 'l1', data: () => ({ chatId: 'c1', status: 'active' }) }],
        })
        .mockResolvedValueOnce({
          docs: [{ id: 'p1', data: () => ({ chatId: 'c2', displayName: 'P1' }) }],
        })
        .mockResolvedValueOnce({
          docs: [{ id: 'u1', data: () => ({ name: 'U1', role: 'teacher' }) }],
        })
        .mockResolvedValueOnce({
          docs: [{ id: 'm1', data: () => ({ contentSnapshot: 'abc', status: 'sent' }) }],
        });

      await dispatchZaloBotAdminAction('admin-overview', req, res, context);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonArgs = res.json.mock.calls[0][0];
      expect(jsonArgs.success).toBe(true);
      expect(jsonArgs.botEnabled).toBe(true);
      expect(jsonArgs.overview.links).toEqual([{ status: 'active' }]);
      expect(jsonArgs.overview.pendingChats).toEqual([{ displayName: 'P1' }]);
      expect(jsonArgs.overview.staff).toEqual([
        { uid: 'u1', displayName: 'U1', email: '', role: 'teacher' },
      ]);
      expect(jsonArgs.overview.recentMessages).toEqual([{ id: 'm1', status: 'sent' }]);
    });

    describe('admin-test', () => {
      beforeEach(() => {
        req.method = 'POST';
        req.body = { staffId: 'staff1' };
      });

      it('returns 503 when bot is disabled', async () => {
        vi.mocked(loadZaloBotConfig).mockReturnValueOnce({ enabled: false } as any);
        await dispatchZaloBotAdminAction('admin-test', req, res, context);
        expect(res.status).toHaveBeenCalledWith(503);
      });

      it('returns 409 when user not found', async () => {
        mockDb.get.mockResolvedValueOnce({ exists: false }).mockResolvedValueOnce({ exists: true });
        await dispatchZaloBotAdminAction('admin-test', req, res, context);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'User not found' });
      });

      it('returns 409 when link not found', async () => {
        mockDb.get.mockResolvedValueOnce({ exists: true }).mockResolvedValueOnce({ exists: false });
        await dispatchZaloBotAdminAction('admin-test', req, res, context);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Link not found' });
      });

      it('returns 409 when user is blocked', async () => {
        mockDb.get
          .mockResolvedValueOnce({ exists: true, data: () => ({ blockedTeacher: true }) })
          .mockResolvedValueOnce({ exists: true, data: () => ({}) });
        await dispatchZaloBotAdminAction('admin-test', req, res, context);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'User is blocked' });
      });

      it('returns 409 for ineligible role', async () => {
        mockDb.get
          .mockResolvedValueOnce({ exists: true, data: () => ({ role: 'student' }) })
          .mockResolvedValueOnce({ exists: true, data: () => ({}) });
        await dispatchZaloBotAdminAction('admin-test', req, res, context);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Ineligible role' });
      });

      it('returns 409 when link is not active', async () => {
        mockDb.get
          .mockResolvedValueOnce({ exists: true, data: () => ({ role: 'teacher' }) })
          .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'disabled' }) });
        await dispatchZaloBotAdminAction('admin-test', req, res, context);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Link is not active' });
      });

      it('returns 409 when role mismatch', async () => {
        mockDb.get
          .mockResolvedValueOnce({ exists: true, data: () => ({ role: 'teacher' }) })
          .mockResolvedValueOnce({
            exists: true,
            data: () => ({ status: 'active', role: 'office' }),
          });
        await dispatchZaloBotAdminAction('admin-test', req, res, context);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Role mismatch' });
      });

      it('succeeds: creates ledger message and outbox job', async () => {
        mockDb.get
          .mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'teacher', displayName: 'Mr A' }),
          })
          .mockResolvedValueOnce({
            exists: true,
            data: () => ({ status: 'active', role: 'teacher', chatIdHash: 'hash' }),
          });

        await dispatchZaloBotAdminAction('admin-test', req, res, context);

        expect(createZaloBotMessageIfAbsent).toHaveBeenCalledWith(
          mockDb,
          expect.objectContaining({
            messageType: 'test',
            staffId: 'staff1',
            role: 'teacher',
            chatIdHash: 'hash',
            contentSnapshot: 'Chào Mr A, đây là tin nhắn kiểm tra hệ thống từ admin.',
            digestDate: expect.any(String),
          })
        );

        expect(createOutboxJob).toHaveBeenCalledWith(
          mockDb,
          {
            type: 'send_zalo_bot_message',
            payload: { messageId: expect.any(String) },
            maxAttempts: 3,
          },
          { actorId: 'u1', operation: 'zalo_bot:admin-test' }
        );

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, messageId: expect.any(String) });
      });
    });
  });
});
