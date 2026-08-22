import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchZaloBotRoute } from '../../server/api/zalo-bot/routeHandler';
import { verifyAuthContext } from '../../server/api/lib/auth/verifyAuth';
import { handleZaloBotWebhook } from '../../server/api/zalo-bot/webhookHandler';
import {
  dispatchZaloBotAdminAction,
  dispatchZaloBotSelfAction,
} from '../../server/api/zalo-bot/linkHandlers';

vi.mock('../../server/api/lib/auth/verifyAuth');
vi.mock('../../server/api/zalo-bot/webhookHandler');
vi.mock('../../server/api/zalo-bot/linkHandlers');

describe('Zalo Bot API Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Route matrix correctly dispatches all 7 actions', async () => {
    const req = { query: { action: 'webhook' } } as any;
    const res = {} as any;

    // 1. webhook
    await dispatchZaloBotRoute('webhook', req, res);
    expect(handleZaloBotWebhook).toHaveBeenCalledWith(req, res);

    // admin actions
    vi.mocked(verifyAuthContext).mockResolvedValueOnce({ context: { role: 'admin' } } as any);
    await dispatchZaloBotRoute('admin-overview', req, res);
    expect(dispatchZaloBotAdminAction).toHaveBeenCalledWith('admin-overview', req, res, {
      role: 'admin',
    });

    vi.mocked(verifyAuthContext).mockResolvedValueOnce({ context: { role: 'admin' } } as any);
    await dispatchZaloBotRoute('admin-link', req, res);
    expect(dispatchZaloBotAdminAction).toHaveBeenCalledWith('admin-link', req, res, {
      role: 'admin',
    });

    vi.mocked(verifyAuthContext).mockResolvedValueOnce({ context: { role: 'admin' } } as any);
    await dispatchZaloBotRoute('admin-unlink', req, res);
    expect(dispatchZaloBotAdminAction).toHaveBeenCalledWith('admin-unlink', req, res, {
      role: 'admin',
    });

    vi.mocked(verifyAuthContext).mockResolvedValueOnce({ context: { role: 'admin' } } as any);
    await dispatchZaloBotRoute('admin-test', req, res);
    expect(dispatchZaloBotAdminAction).toHaveBeenCalledWith('admin-test', req, res, {
      role: 'admin',
    });

    // self actions
    vi.mocked(verifyAuthContext).mockResolvedValueOnce({ context: { role: 'teacher' } } as any);
    await dispatchZaloBotRoute('my-link', req, res);
    expect(dispatchZaloBotSelfAction).toHaveBeenCalledWith('my-link', req, res, {
      role: 'teacher',
    });

    vi.mocked(verifyAuthContext).mockResolvedValueOnce({ context: { role: 'office' } } as any);
    await dispatchZaloBotRoute('create-link-code', req, res);
    expect(dispatchZaloBotSelfAction).toHaveBeenCalledWith('create-link-code', req, res, {
      role: 'office',
    });

    vi.mocked(verifyAuthContext).mockResolvedValueOnce({ context: { role: 'teacher' } } as any);
    await dispatchZaloBotRoute('unlink', req, res);
    expect(dispatchZaloBotSelfAction).toHaveBeenCalledWith('unlink', req, res, { role: 'teacher' });
  });

  it('Wrong roles rejected with 403', async () => {
    const req = { query: { action: 'admin-overview' } } as any;
    const res = {} as any;
    vi.mocked(verifyAuthContext).mockResolvedValueOnce(null);

    await dispatchZaloBotRoute('admin-overview', req, res);

    expect(dispatchZaloBotAdminAction).not.toHaveBeenCalled();
    expect(dispatchZaloBotSelfAction).not.toHaveBeenCalled();
  });
});
