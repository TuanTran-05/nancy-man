import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const chatMocks = vi.hoisted(() => ({ answerZaloBotChatMessage: vi.fn() }));

vi.mock('./chat/chatService.js', () => ({
  answerZaloBotChatMessage: chatMocks.answerZaloBotChatMessage,
}));

import { handleZaloBotWebhook } from './webhookHandler.js';
import { loadZaloBotConfig } from './config';
import { getDb } from '../lib/auth/verifyAuth';
import * as linkRepo from './linkRepository';
import { ensureZaloBotLinkConfirmation } from './linkConfirmationService';
import { createInMemoryDocumentStore } from '../../../test-utils/inMemoryDocumentStore';

vi.mock('./config');
vi.mock('../lib/auth/verifyAuth');
vi.mock('./linkRepository');
vi.mock('./linkConfirmationService');

describe('Zalo Bot Webhook Handler', () => {
  let req: any;
  let res: any;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadZaloBotConfig).mockReturnValue({
      enabled: true,
      webhookSecret: 'test-secret',
    } as any);

    req = {
      method: 'POST',
      headers: {
        'x-bot-api-secret-token': 'test-secret',
      },
      body: {
        ok: true,
        result: {
          event_name: 'user_send_text',
          message: {
            from: { id: 'u123', display_name: 'Test User' },
            chat: { id: 'c123', chat_type: 'PRIVATE' },
            text: 'hello',
            message_id: 'm123',
          },
        },
      },
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const { db } = createInMemoryDocumentStore({});
    vi.mocked(getDb).mockReturnValue(db as any);
  });

  it('Missing/wrong secret returns 403 before body parsing', async () => {
    req.headers['x-bot-api-secret-token'] = 'wrong';
    await handleZaloBotWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('GROUP chat returns 200 { ignored: true } without persistence', async () => {
    req.body.result.message.chat.chat_type = 'GROUP';
    await handleZaloBotWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ignored: true, reason: 'group_chat_not_supported' });
    expect(linkRepo.touchActiveZaloBotLinkFromWebhook).not.toHaveBeenCalled();
    expect(linkRepo.recordPendingZaloBotChat).not.toHaveBeenCalled();
  });

  it('Malformed body returns 400', async () => {
    req.body = { foo: 'bar' };
    await handleZaloBotWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // Hình dạng thật Zalo gửi, bắt được bằng getUpdates ngày 2026-08-16: update
  // phẳng, KHÔNG có vỏ { ok, result } như tài liệu mô tả. Trước khi sửa, mọi
  // tin nhắn thật đều rơi vào 400 và không để lại dấu vết nào trong DocumentStore.
  const flatUpdate = () => ({
    event_name: 'message.text.received',
    message: {
      from: { id: 'ff3e7fda', is_bot: false, display_name: 'Tuấn Trần' },
      chat: { id: 'ff3e7fda', chat_type: 'PRIVATE' },
      text: 'hahah',
      message_id: '9e787c8804f986a0dfef',
      date: 1786823470593,
    },
  });

  it('accepts the flat update Zalo actually sends, without the ok/result envelope', async () => {
    req.body = flatUpdate();
    vi.mocked(linkRepo.touchActiveZaloBotLinkFromWebhook).mockResolvedValue('unlinked');

    await handleZaloBotWebhook(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(linkRepo.recordPendingZaloBotChat).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('consumes a /link code from a flat update', async () => {
    req.body = flatUpdate();
    req.body.message.text = '/link ABCD1234';
    vi.mocked(linkRepo.consumeZaloBotLinkCode).mockResolvedValue({
      staffId: 'staff_1',
      linkedAt: '2026-08-15T12:00:00.000Z',
    } as any);

    const { db, store } = createInMemoryDocumentStore({});
    vi.mocked(getDb).mockReturnValue(db as any);
    store.set('_maintenance/zaloBotWebhook_9e787c8804f986a0dfef', {});

    await handleZaloBotWebhook(req, res);

    expect(linkRepo.consumeZaloBotLinkCode).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('still accepts the documented ok/result envelope', async () => {
    vi.mocked(linkRepo.touchActiveZaloBotLinkFromWebhook).mockResolvedValue('unlinked');
    await handleZaloBotWebhook(req, res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(linkRepo.recordPendingZaloBotChat).toHaveBeenCalled();
  });

  it('rejects a flat update missing event_name', async () => {
    const body: any = flatUpdate();
    delete body.event_name;
    req.body = body;
    await handleZaloBotWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('/link CODE message consumes code, returns success and enqueues confirmation', async () => {
    req.body.result.message.text = '/link ABCD1234';
    vi.mocked(linkRepo.consumeZaloBotLinkCode).mockResolvedValue({
      staffId: 'staff_1',
      linkedAt: '2026-08-15T12:00:00.000Z',
    } as any);

    const { db, store } = createInMemoryDocumentStore({});
    vi.mocked(getDb).mockReturnValue(db as any);
    store.set('_maintenance/zaloBotWebhook_m123', {}); // pre-create marker for update

    await handleZaloBotWebhook(req, res);
    expect(linkRepo.consumeZaloBotLinkCode).toHaveBeenCalled();
    expect(ensureZaloBotLinkConfirmation).toHaveBeenCalledWith(db, {
      staffId: 'staff_1',
      linkedAt: '2026-08-15T12:00:00.000Z',
    });

    expect(store.get('_maintenance/zaloBotWebhook_m123').confirmationStatus).toBe('enqueued');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('Normal message from active linked chat only updates lastSeenAt', async () => {
    vi.mocked(linkRepo.touchActiveZaloBotLinkFromWebhook).mockResolvedValue('updated');
    await handleZaloBotWebhook(req, res);
    expect(linkRepo.touchActiveZaloBotLinkFromWebhook).toHaveBeenCalled();
    expect(linkRepo.recordPendingZaloBotChat).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ignored: true });
  });

  it('Normal message recorded as pending, returns { ignored: true }', async () => {
    vi.mocked(linkRepo.touchActiveZaloBotLinkFromWebhook).mockResolvedValue('unlinked');
    await handleZaloBotWebhook(req, res);
    expect(linkRepo.touchActiveZaloBotLinkFromWebhook).toHaveBeenCalled();
    expect(linkRepo.recordPendingZaloBotChat).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ignored: true });
  });

  it('Valid update without text returns 200 ignored', async () => {
    delete req.body.result.message.text;
    await handleZaloBotWebhook(req, res);
    expect(linkRepo.recordIgnoredZaloBotWebhookEvent).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ignored: true });
  });

  it('username optional - no failure when absent', async () => {
    req.body.result.message.text = '/link ABCD1234';
    delete req.body.result.message.from.username;
    await handleZaloBotWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('Duplicate messages deduplicated (same messageId returns stored outcome, enqueues confirmation)', async () => {
    req.body.result.message.text = '/link ABCD1234';
    vi.mocked(linkRepo.consumeZaloBotLinkCode).mockRejectedValue(
      new Error('WEBHOOK_ALREADY_PROCESSED')
    );

    const { db, store } = createInMemoryDocumentStore({});
    vi.mocked(getDb).mockReturnValue(db as any);
    store.set('_maintenance/zaloBotWebhook_m123', {
      outcome: 'linked',
      staffId: 'staff_2',
      linkedAt: '2026-08-15T12:00:00.000Z',
    });

    await handleZaloBotWebhook(req, res);

    expect(ensureZaloBotLinkConfirmation).toHaveBeenCalledWith(db, {
      staffId: 'staff_2',
      linkedAt: '2026-08-15T12:00:00.000Z',
    });
    expect(store.get('_maintenance/zaloBotWebhook_m123').confirmationStatus).toBe('enqueued');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  describe('chat replies', () => {
    const chatHashSecret = 'chat-hash-secret';

    function enableChat() {
      vi.mocked(loadZaloBotConfig).mockReturnValue({
        enabled: true,
        chatEnabled: true,
        webhookSecret: 'test-secret',
        chatHashSecret,
        token: 'token',
        requestTimeoutMs: 10_000,
      } as any);
    }

    function seedActiveChat(chatId = 'c123', staffId = 'teacher_a') {
      const chatIdHash = createHmac('sha256', chatHashSecret).update(chatId).digest('hex');
      const memory = createInMemoryDocumentStore({
        [`zalo_bot_chat_claims/${chatIdHash}`]: {
          staffId,
          released: false,
        },
        [`zalo_bot_links/${staffId}`]: {
          staffId,
          chatId,
          chatIdHash,
          status: 'active',
          role: 'teacher',
        },
      });
      vi.mocked(getDb).mockReturnValue(memory.db as any);
      vi.mocked(linkRepo.touchActiveZaloBotLinkFromWebhook).mockResolvedValue('updated');
      return { ...memory, chatIdHash };
    }

    beforeEach(() => {
      enableChat();
      chatMocks.answerZaloBotChatMessage.mockResolvedValue({ outcome: 'answered' });
    });

    it('hands a linked chat message to the chat service and still returns 200', async () => {
      seedActiveChat();

      await handleZaloBotWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ accepted: true });
      expect(chatMocks.answerZaloBotChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ staffId: 'teacher_a', chatId: 'c123', zaloMessageId: 'm123' }),
        expect.anything()
      );
    });

    it('does not call the chat service when chat is disabled', async () => {
      vi.mocked(loadZaloBotConfig).mockReturnValue({
        enabled: true,
        chatEnabled: false,
        webhookSecret: 'test-secret',
        chatHashSecret,
      } as any);
      vi.mocked(linkRepo.touchActiveZaloBotLinkFromWebhook).mockResolvedValue('updated');

      await handleZaloBotWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(chatMocks.answerZaloBotChatMessage).not.toHaveBeenCalled();
    });

    it('does not call the chat service for an unlinked chat', async () => {
      vi.mocked(linkRepo.touchActiveZaloBotLinkFromWebhook).mockResolvedValue('unlinked');

      await handleZaloBotWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(chatMocks.answerZaloBotChatMessage).not.toHaveBeenCalled();
    });

    it('still returns 200 when the chat service throws', async () => {
      seedActiveChat();
      chatMocks.answerZaloBotChatMessage.mockRejectedValue(new Error('boom'));

      await handleZaloBotWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('does not revive a released old-chat claim when its webhook is replayed', async () => {
      const oldHash = createHmac('sha256', chatHashSecret).update('c123').digest('hex');
      const newHash = createHmac('sha256', chatHashSecret).update('new_chat').digest('hex');
      const memory = createInMemoryDocumentStore({
        [`zalo_bot_chat_claims/${oldHash}`]: { staffId: 'teacher_a', released: true },
        'zalo_bot_links/teacher_a': {
          staffId: 'teacher_a',
          chatId: 'new_chat',
          chatIdHash: newHash,
          status: 'active',
          role: 'teacher',
        },
      });
      vi.mocked(getDb).mockReturnValue(memory.db as any);
      vi.mocked(linkRepo.touchActiveZaloBotLinkFromWebhook).mockResolvedValue('replayed');

      await handleZaloBotWebhook(req, res);

      expect(chatMocks.answerZaloBotChatMessage).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ignored: true });
    });
  });
});
