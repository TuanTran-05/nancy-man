import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInMemoryDocumentStore } from '../../../test-utils/inMemoryDocumentStore';
import {
  issueZaloBotLinkCode,
  consumeZaloBotLinkCode,
  recordPendingZaloBotChat,
  adminLinkZaloBotChat,
  disableZaloBotLink,
  touchActiveZaloBotLinkFromWebhook,
  recordIgnoredZaloBotWebhookEvent,
  type LinkRepositoryDeps,
} from './linkRepository';
import crypto from 'crypto';

function hmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

describe('linkRepository', () => {
  let db: any;
  let store: Map<string, any>;
  let nowString: string;
  let codeCount: number;
  let deps: LinkRepositoryDeps;

  beforeEach(() => {
    const memDb = createInMemoryDocumentStore({});
    db = memDb.db;
    store = memDb.store;
    nowString = '2026-08-15T12:00:00.000Z';
    codeCount = 0;

    deps = {
      now: () => nowString,
      generateCode: () => {
        codeCount++;
        return `TESTCODE${codeCount}`; // 10 chars
      },
      hmac,
      config: {
        linkCodePepper: 'pepper',
        chatHashSecret: 'chatSecret',
        enabled: true,
        dailyDigestEnabled: true,
        chatEnabled: false,
        adminDataEnabled: false,
        adminIntentsEnabled: [],
        adminSnapshotRefreshEnabled: false,
        adminPilotUids: [],
        adminReadAuditRetentionDays: 90,
        dryRun: false,
        token: 'token',
        webhookSecret: 'webhook',
        appUrl: 'http://localhost',
        requestTimeoutMs: 10000,
      },
    };
  });

  it('1. Issued code has generated chars, expires after 10 mins, only HMAC stored', async () => {
    deps.generateCode = () => '12345678'; // 8 char code
    const res = await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );
    expect(res.code).toBe('12345678');
    expect(res.expiresAt).toBe('2026-08-15T12:10:00.000Z');

    const codeHash = hmac('pepper', '12345678');
    const doc = store.get(`zalo_bot_link_codes/${codeHash}`);
    expect(doc).toBeDefined();
    expect(doc.staffId).toBe('staff-1');
  });

  it('2. Valid unexpired code creates active link, active chat claim, consumed timestamp atomically', async () => {
    deps.generateCode = () => 'ABCDEFGH';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );

    const link = await consumeZaloBotLinkCode(
      db,
      {
        code: 'ABCDEFGH',
        chatId: 'chat-1',
        displayName: 'Chat 1',
        webhookEventId: 'evt-1',
      },
      deps
    );

    expect(link.staffId).toBe('staff-1');
    expect(link.status).toBe('active');
    expect(link.confirmationStatus).toBe('pending');

    const codeHash = hmac('pepper', 'ABCDEFGH');
    expect(store.get(`zalo_bot_link_codes/${codeHash}`).consumedAt).toBe(nowString);

    const chatIdHash = hmac('chatSecret', 'chat-1');
    expect(store.get(`zalo_bot_chat_claims/${chatIdHash}`).staffId).toBe('staff-1');
    expect(store.get(`_maintenance/zaloBotWebhook_evt-1`).outcome).toBe('linked');
  });

  it('3. Already claimed chat cannot be assigned to second staff', async () => {
    deps.generateCode = () => 'CODE1111';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );
    await consumeZaloBotLinkCode(
      db,
      { code: 'CODE1111', chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
      deps
    );

    deps.generateCode = () => 'CODE2222';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-2', role: 'teacher', displayName: 'Staff 2' },
      deps
    );

    await expect(
      consumeZaloBotLinkCode(
        db,
        { code: 'CODE2222', chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-2' },
        deps
      )
    ).rejects.toThrow('CHAT_ALREADY_CLAIMED');
  });

  it('4. Re-linking same staff releases previous chat claim before claiming new one', async () => {
    deps.generateCode = () => 'CODE1111';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );
    await consumeZaloBotLinkCode(
      db,
      { code: 'CODE1111', chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
      deps
    );

    deps.generateCode = () => 'CODE2222';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );
    await consumeZaloBotLinkCode(
      db,
      { code: 'CODE2222', chatId: 'chat-2', displayName: 'Chat 2', webhookEventId: 'evt-2' },
      deps
    );

    const oldChatIdHash = hmac('chatSecret', 'chat-1');
    const newChatIdHash = hmac('chatSecret', 'chat-2');

    expect(store.get(`zalo_bot_chat_claims/${oldChatIdHash}`).released).toBe(true);
    expect(store.get(`zalo_bot_chat_claims/${newChatIdHash}`).released).toBe(false);
  });

  it('5. Admin manual link requires pending chat, records linkedMethod:admin', async () => {
    const chatIdHash = hmac('chatSecret', 'chat-1');
    await recordPendingZaloBotChat(
      db,
      { chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
      deps
    );

    const link = await adminLinkZaloBotChat(
      db,
      {
        staff: { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
        chatIdHash,
        adminId: 'admin-1',
      },
      deps
    );

    expect(link.linkedMethod).toBe('admin');
    expect(link.linkedBy).toBe('admin-1');
    expect(store.get(`zalo_bot_links/staff-1`).status).toBe('active');
  });

  it('6. Self-linking records linkedMethod:self and linkedBy=staffId', async () => {
    deps.generateCode = () => 'CODE1111';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );
    const link = await consumeZaloBotLinkCode(
      db,
      { code: 'CODE1111', chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
      deps
    );

    expect(link.linkedMethod).toBe('self');
    expect(link.linkedBy).toBe('staff-1');
  });

  it('7. Unlink: status->disabled, claim->released, no delete', async () => {
    deps.generateCode = () => 'CODE1111';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );
    await consumeZaloBotLinkCode(
      db,
      { code: 'CODE1111', chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
      deps
    );

    await disableZaloBotLink(db, { staffId: 'staff-1', actorId: 'admin-1' }, deps);

    expect(store.get(`zalo_bot_links/staff-1`).status).toBe('disabled');
    const chatIdHash = hmac('chatSecret', 'chat-1');
    expect(store.get(`zalo_bot_chat_claims/${chatIdHash}`).released).toBe(true);
  });

  it('8. Expired/consumed codes fail without creating link', async () => {
    deps.generateCode = () => 'CODE1111';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );

    nowString = '2026-08-15T12:20:00.000Z'; // 20 mins later, expired
    await expect(
      consumeZaloBotLinkCode(
        db,
        { code: 'CODE1111', chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
        deps
      )
    ).rejects.toThrow('INVALID_CODE');
    expect(store.has('zalo_bot_links/staff-1')).toBe(false);
  });

  it('9. Five failed attempts block for 15 minutes', async () => {
    const testCases = [1, 2, 3, 4, 5];
    for (const i of testCases) {
      await expect(
        consumeZaloBotLinkCode(
          db,
          { code: 'BADCODE', chatId: 'chat-bad', displayName: 'Bad', webhookEventId: `evt-${i}` },
          deps
        )
      ).rejects.toThrow('INVALID_CODE');
    }

    const chatIdHash = hmac('chatSecret', 'chat-bad');
    const pending = store.get(`zalo_bot_pending_chats/${chatIdHash}`);
    expect(pending.attemptCount).toBe(5);
    expect(pending.blockedUntil).toBe('2026-08-15T12:15:00.000Z');

    await expect(
      consumeZaloBotLinkCode(
        db,
        { code: 'BADCODE', chatId: 'chat-bad', displayName: 'Bad', webhookEventId: 'evt-6' },
        deps
      )
    ).rejects.toThrow('BLOCKED');
  });

  it('10. Webhook sender without username stored successfully', async () => {
    await recordPendingZaloBotChat(
      db,
      { chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
      deps
    );
    const chatIdHash = hmac('chatSecret', 'chat-1');
    const pending = store.get(`zalo_bot_pending_chats/${chatIdHash}`);
    expect(pending.displayName).toBe('Chat 1');
    expect(pending.username).toBeUndefined();
  });

  it('11. Webhook event and link/pending mutation commit atomically; replay of processed webhookEventId returns stored outcome without consuming code twice', async () => {
    deps.generateCode = () => 'CODE1111';
    await issueZaloBotLinkCode(
      db,
      { uid: 'staff-1', role: 'teacher', displayName: 'Staff 1' },
      deps
    );
    await consumeZaloBotLinkCode(
      db,
      { code: 'CODE1111', chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
      deps
    );

    await expect(
      consumeZaloBotLinkCode(
        db,
        { code: 'CODE1111', chatId: 'chat-1', displayName: 'Chat 1', webhookEventId: 'evt-1' },
        deps
      )
    ).rejects.toThrow('WEBHOOK_ALREADY_PROCESSED');

    // recordIgnoredZaloBotWebhookEvent handles replay
    const res = await recordIgnoredZaloBotWebhookEvent(
      db,
      { webhookEventId: 'evt-1', eventName: 'any', outcome: 'any' },
      deps
    );
    expect(res).toBe('replayed');
  });

  it('touchActiveZaloBotLinkFromWebhook returns unlinked if chat claim released', async () => {
    const res = await touchActiveZaloBotLinkFromWebhook(
      db,
      { chatId: 'chat-1', webhookEventId: 'evt-1' },
      deps
    );
    expect(res).toBe('unlinked');
    expect(store.has('_maintenance/zaloBotWebhook_evt-1')).toBe(false);
  });

  it('records a first unlinked private message as pending before consuming its replay marker', async () => {
    const outcome = await touchActiveZaloBotLinkFromWebhook(
      db,
      { chatId: 'chat-new', webhookEventId: 'evt-pending' },
      deps
    );
    expect(outcome).toBe('unlinked');

    await recordPendingZaloBotChat(
      db,
      {
        chatId: 'chat-new',
        displayName: 'Pending User',
        webhookEventId: 'evt-pending',
      },
      deps
    );

    const chatIdHash = hmac('chatSecret', 'chat-new');
    expect(store.get(`zalo_bot_pending_chats/${chatIdHash}`)?.displayName).toBe('Pending User');
    expect(store.get('_maintenance/zaloBotWebhook_evt-pending')?.outcome).toBe('recorded');

    await expect(
      touchActiveZaloBotLinkFromWebhook(
        db,
        { chatId: 'chat-new', webhookEventId: 'evt-pending' },
        deps
      )
    ).resolves.toBe('replayed');
  });

  it('counts a replayed invalid link command only once', async () => {
    const input = {
      code: 'BADCODE1',
      chatId: 'chat-bad-replay',
      displayName: 'Bad Replay',
      webhookEventId: 'evt-bad-replay',
    };

    await expect(consumeZaloBotLinkCode(db, input, deps)).rejects.toThrow('INVALID_CODE');
    await expect(consumeZaloBotLinkCode(db, input, deps)).rejects.toThrow(
      'WEBHOOK_ALREADY_PROCESSED'
    );

    const chatIdHash = hmac('chatSecret', input.chatId);
    expect(store.get(`zalo_bot_pending_chats/${chatIdHash}`)?.attemptCount).toBe(1);
  });
});
