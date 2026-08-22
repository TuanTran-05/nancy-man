import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryDocumentStore } from '../../../test-utils/inMemoryDocumentStore.js';
import {
  ensureZaloBotLinkConfirmation,
  repairPendingZaloBotLinkConfirmations,
} from './linkConfirmationService.js';
import { ZaloBotMessage } from '../../../shared/zaloBot.js';

vi.mock('../lib/jobs/outbox.js', () => ({
  createOutboxJob: vi.fn().mockResolvedValue('fake-job-id'),
}));

import { createOutboxJob } from '../lib/jobs/outbox.js';

describe('linkConfirmationService', () => {
  let db: any;
  let store: Map<string, any>;
  let nowString: string;

  beforeEach(() => {
    const memDb = createInMemoryDocumentStore({});
    db = memDb.db;
    store = memDb.store;
    nowString = '2026-08-15T12:00:00.000Z';
    vi.clearAllMocks();
  });

  describe('ensureZaloBotLinkConfirmation', () => {
    it('successfully creates ledger and enqueues job for active link', async () => {
      const linkedAt = '2026-08-15T12:00:00.000Z';
      const staffId = 'staff_1';

      store.set(`zalo_bot_links/staff_1`, {
        staffId,
        chatIdHash: 'chash1',
        role: 'teacher',
        status: 'active',
        linkedAt,
      });

      const result = await ensureZaloBotLinkConfirmation(db, {
        staffId,
        linkedAt,
      });

      const epochMs = Date.parse(linkedAt);
      const expectedMessageId = `link_confirmation_${staffId}_${epochMs}`;

      expect(result.messageId).toBe(expectedMessageId);
      expect(result.ledger).toBe('created');
      expect(result.jobId).toBe('fake-job-id');

      const msg = store.get(`zalo_bot_messages/${expectedMessageId}`);
      expect(msg).toBeDefined();
      expect(msg.messageType).toBe('link_confirmation');
      expect(msg.contentSnapshot).not.toContain('chash1');
      expect(msg.contentSnapshot).toContain('Zalo Bot đã liên kết thành công');
      expect(msg.digestDate).toBe('2026-08-15');

      expect(createOutboxJob).toHaveBeenCalledWith(
        db,
        {
          type: 'send_zalo_bot_message',
          payload: { messageId: expectedMessageId },
          idempotencyKey: `zalo-bot:${expectedMessageId}`,
          maxAttempts: 3,
        },
        {
          actorId: 'webhook:zalo-bot',
          operation: 'zalo_bot:enqueue-link-confirmation',
        }
      );
    });

    it('skips stale link (status not active)', async () => {
      store.set(`zalo_bot_links/staff_1`, {
        status: 'disabled',
        linkedAt: '2026-08-15T12:00:00.000Z',
      });
      await expect(
        ensureZaloBotLinkConfirmation(db, {
          staffId: 'staff_1',
          linkedAt: '2026-08-15T12:00:00.000Z',
        })
      ).rejects.toThrow('STALE_LINK');
    });

    it('skips stale link (linkedAt mismatch)', async () => {
      store.set(`zalo_bot_links/staff_1`, {
        status: 'active',
        linkedAt: '2026-08-15T12:00:00.000Z',
      });
      await expect(
        ensureZaloBotLinkConfirmation(db, {
          staffId: 'staff_1',
          linkedAt: '2026-08-15T10:00:00.000Z',
        })
      ).rejects.toThrow('STALE_LINK');
    });

    it('is idempotent on replay (existing pending msg still creates job)', async () => {
      const linkedAt = '2026-08-15T12:00:00.000Z';
      const staffId = 'staff_1';
      const epochMs = Date.parse(linkedAt);
      const expectedMessageId = `link_confirmation_${staffId}_${epochMs}`;

      store.set(`zalo_bot_links/staff_1`, {
        staffId,
        chatIdHash: 'chash1',
        role: 'teacher',
        status: 'active',
        linkedAt,
      });

      store.set(`zalo_bot_messages/${expectedMessageId}`, {
        status: 'pending',
      });

      const result = await ensureZaloBotLinkConfirmation(db, { staffId, linkedAt });

      expect(result.ledger).toBe('existing');
      expect(createOutboxJob).toHaveBeenCalled();
    });

    it('is idempotent on replay (existing sent msg skips job)', async () => {
      const linkedAt = '2026-08-15T12:00:00.000Z';
      const staffId = 'staff_1';
      const epochMs = Date.parse(linkedAt);
      const expectedMessageId = `link_confirmation_${staffId}_${epochMs}`;

      store.set(`zalo_bot_links/staff_1`, {
        staffId,
        chatIdHash: 'chash1',
        role: 'teacher',
        status: 'active',
        linkedAt,
      });

      store.set(`zalo_bot_messages/${expectedMessageId}`, {
        status: 'sent',
      });

      const result = await ensureZaloBotLinkConfirmation(db, { staffId, linkedAt });

      expect(result.ledger).toBe('existing');
      expect(result.jobId).toBe(`zalo-bot:${expectedMessageId}`);
      expect(createOutboxJob).not.toHaveBeenCalled();
    });
  });

  describe('repairPendingZaloBotLinkConfirmations', () => {
    it('scans and repairs pending maintenance tasks', async () => {
      store.set('_maintenance/m1', {
        kind: 'zalo_bot_webhook',
        confirmationStatus: 'pending',
        staffId: 'staff_1',
        linkedAt: '2026-08-15T12:00:00.000Z',
      });
      store.set('_maintenance/m2', {
        kind: 'other_thing',
        confirmationStatus: 'pending',
      });
      store.set('_maintenance/m3', {
        kind: 'zalo_bot_webhook',
        confirmationStatus: 'pending',
        staffId: 'staff_stale',
        linkedAt: '2026-08-14T00:00:00.000Z',
      });

      store.set('zalo_bot_links/staff_1', {
        staffId: 'staff_1',
        chatIdHash: 'c1',
        status: 'active',
        linkedAt: '2026-08-15T12:00:00.000Z',
      });
      store.set('zalo_bot_links/staff_stale', {
        staffId: 'staff_stale',
        chatIdHash: 'c2',
        status: 'active',
        linkedAt: '2026-08-15T12:00:00.000Z',
      }); // mismatched time

      const result = await repairPendingZaloBotLinkConfirmations(db);

      expect(result.scanned).toBe(3);
      expect(result.enqueued).toBe(1); // m1
      expect(result.skipped).toBe(2); // m2 (kind), m3 (stale)

      expect(store.get('_maintenance/m1').confirmationStatus).toBe('enqueued');
      expect(store.get('_maintenance/m3').confirmationStatus).toBe('pending');
    });
  });
});
