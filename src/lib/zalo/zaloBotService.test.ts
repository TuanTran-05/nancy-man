import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getMyZaloBotLink,
  createMyZaloBotLinkCode,
  unlinkMyZaloBotChat,
  getZaloBotAdminOverview,
  adminLinkZaloBotChat,
  adminUnlinkZaloBotStaff,
  adminSendZaloBotTest,
} from './zaloBotService';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('zaloBotService', () => {
  it('getMyZaloBotLink calls correct endpoint and returns data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ botEnabled: true, link: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getMyZaloBotLink();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/zalo-bot/my-link',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
      })
    );
    expect(result).toEqual({ botEnabled: true, link: null });
  });

  it('createMyZaloBotLinkCode calls POST endpoint and returns code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: '12345678', expiresAt: 'some-date' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createMyZaloBotLinkCode();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/zalo-bot/create-link-code',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
      })
    );
    expect(result).toEqual({ code: '12345678', expiresAt: 'some-date' });
  });

  it('unlinkMyZaloBotChat calls POST endpoint and returns success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await unlinkMyZaloBotChat();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/zalo-bot/unlink',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
      })
    );
    expect(result).toEqual({ success: true });
  });

  it('getZaloBotAdminOverview calls GET endpoint and returns overview', async () => {
    const mockOverview = { links: [], pendingChats: [], staff: [], recentMessages: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ botEnabled: true, overview: mockOverview }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getZaloBotAdminOverview();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/zalo-bot/admin-overview',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
      })
    );
    expect(result).toEqual({ botEnabled: true, overview: mockOverview });
  });

  it('adminLinkZaloBotChat calls POST endpoint with staffId and chatIdHash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adminLinkZaloBotChat({ staffId: 'user-1', chatIdHash: 'hash-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/zalo-bot/admin-link',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
        body: JSON.stringify({ staffId: 'user-1', chatIdHash: 'hash-1' }),
      })
    );
    expect(result).toEqual({ success: true });
  });

  it('adminUnlinkZaloBotStaff calls POST endpoint with staffId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adminUnlinkZaloBotStaff('user-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/zalo-bot/admin-unlink',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
        body: JSON.stringify({ staffId: 'user-1' }),
      })
    );
    expect(result).toEqual({ success: true });
  });

  it('adminSendZaloBotTest calls POST endpoint with staffId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, messageId: 'msg-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adminSendZaloBotTest('user-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/zalo-bot/admin-test',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
        body: JSON.stringify({ staffId: 'user-1' }),
      })
    );
    expect(result).toEqual({ success: true, messageId: 'msg-1' });
  });
});
