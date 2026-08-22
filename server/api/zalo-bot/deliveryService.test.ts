import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deliverZaloBotMessage } from './deliveryService';
import { createInMemoryDocumentStore } from '../../../test-utils/inMemoryDocumentStore';
import { ZaloBotApiError } from './botClient';
import { OutboxHandlerError } from '../lib/jobs/outbox';
import crypto from 'crypto';

describe('deliveryService', () => {
  let db: any;
  let store: Map<string, any>;
  let sendTextMock: any;
  let config: any;

  beforeEach(() => {
    const memDb = createInMemoryDocumentStore({});
    db = memDb.db;
    store = memDb.store;
    sendTextMock = vi.fn();
    config = {
      enabled: true,
      dryRun: false,
      token: 'test-token',
      chatHashSecret: 'chatSecret',
      linkCodePepper: 'pepper',
      webhookSecret: 'webhook',
      appUrl: 'http://localhost',
      requestTimeoutMs: 10000,
    };
  });

  const setupData = async (
    msgStatus = 'pending',
    linkStatus = 'active',
    userRole = 'teacher',
    blocked = false
  ) => {
    const realHash = crypto.createHmac('sha256', 'chatSecret').update('chat1').digest('hex');

    store.set('zalo_bot_messages/msg1', {
      id: 'msg1',
      staffId: 'staff1',
      role: 'teacher',
      chatIdHash: realHash,
      digestDate: '2026-08-15',
      messageType: 'daily_digest',
      contentSnapshot: 'Hello test',
      status: msgStatus,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    store.set('zalo_bot_links/staff1', {
      staffId: 'staff1',
      chatId: 'chat1',
      chatIdHash: realHash,
      status: linkStatus,
      role: userRole, // if mismatch, set this differently
    });

    store.set('users/staff1', {
      uid: 'staff1',
      role: userRole,
      blockedTeacher: blocked,
    });

    store.set(`zalo_bot_chat_claims/${realHash}`, {
      staffId: 'staff1',
      released: false,
    });
  };

  it('1. Claims pending ledger, reloads link and user, sends contentSnapshot when eligible', async () => {
    await setupData();
    sendTextMock.mockResolvedValue({ messageId: 'prov-msg-1' });

    await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });

    expect(sendTextMock).toHaveBeenCalledWith({ chatId: 'chat1', text: 'Hello test' }, config);

    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('sent');
    expect(msg.providerMessageId).toBe('prov-msg-1');
  });

  it('2. Second worker sees fresh claim as busy, does nothing', async () => {
    await setupData('processing');
    store.set('zalo_bot_messages/msg1', {
      ...store.get('zalo_bot_messages/msg1'),
      processingStartedAt: new Date().toISOString(),
    });

    await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('3. 5-min-stale claim is reclaimed by one worker', async () => {
    await setupData('processing');
    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    store.set('zalo_bot_messages/msg1', {
      ...store.get('zalo_bot_messages/msg1'),
      processingStartedAt: staleTime,
    });
    sendTextMock.mockResolvedValue({ messageId: 'prov-msg-1' });

    await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });

    expect(sendTextMock).toHaveBeenCalled();
    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('sent');
  });

  it('5. Missing/disabled link -> skipped, no provider call', async () => {
    await setupData('pending', 'disabled');

    await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });

    expect(sendTextMock).not.toHaveBeenCalled();
    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('skipped');
    expect(msg.errorCode).toBe('ineligible');
  });

  it('6. Ineligible user -> skipped, no provider call', async () => {
    // Role mismatch
    await setupData('pending', 'active', 'student');

    await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });

    expect(sendTextMock).not.toHaveBeenCalled();
    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('skipped');
  });

  it('7. invalid_chat -> skipped, link to needs_relink, no throw', async () => {
    await setupData();
    sendTextMock.mockRejectedValue(new ZaloBotApiError('invalid', 'invalid_chat', 400));

    await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });

    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('skipped');
    expect(msg.errorCode).toBe('invalid_chat');

    const link = store.get('zalo_bot_links/staff1');
    expect(link.status).toBe('needs_relink');
  });

  it('8. rate_limited -> retryable OutboxHandlerError with retryAfterMs', async () => {
    await setupData();
    sendTextMock.mockRejectedValue(new ZaloBotApiError('rate limited', 'rate_limited', 429, 5000));

    await expect(
      deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock })
    ).rejects.toThrow(OutboxHandlerError);

    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('failed');
    expect(msg.attempts).toBe(1);
    expect(msg.errorCode).toBe('rate_limited');
  });

  it('9. transient -> retryable error, sets deliveryAmbiguous', async () => {
    await setupData();
    sendTextMock.mockRejectedValue(new ZaloBotApiError('network timeout', 'transient', 0, 0, true));

    await expect(
      deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock })
    ).rejects.toThrow(OutboxHandlerError);

    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('failed');
    expect(msg.deliveryAmbiguous).toBe(true);
  });

  it('11. 401 creates admin incident and throws abortBatch', async () => {
    await setupData();
    sendTextMock.mockRejectedValue(new ZaloBotApiError('auth fail', 'auth', 401));

    let thrownErr: any;
    try {
      await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });
    } catch (err) {
      thrownErr = err;
    }

    expect(thrownErr).toBeInstanceOf(OutboxHandlerError);
    expect(thrownErr.options.abortBatch).toBe(true);

    const adminIncident = store.get('admin_notifications/zalo_bot_auth_2026-08-15');
    expect(adminIncident).toBeDefined();
    expect(adminIncident.type).toBe('zalo_bot_auth_error');
  });

  it('12. Permanent error -> non-retryable OutboxHandlerError', async () => {
    await setupData();
    sendTextMock.mockRejectedValue(new ZaloBotApiError('bad format', 'permanent', 400));

    let thrownErr: any;
    try {
      await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });
    } catch (err) {
      thrownErr = err;
    }

    expect(thrownErr).toBeInstanceOf(OutboxHandlerError);
    expect(thrownErr.options.retryable).toBe(false);

    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('failed');
  });

  it('14. ZALO_BOT_ENABLED=false skips without provider call', async () => {
    await setupData();
    config.enabled = false;

    await deliverZaloBotMessage(db, { messageId: 'msg1' }, { config, sendText: sendTextMock });

    expect(sendTextMock).not.toHaveBeenCalled();
    const msg = store.get('zalo_bot_messages/msg1');
    expect(msg.status).toBe('skipped');
  });
});
