import type { DocumentStore } from '@/server/db/documentStore.js';
import { parseISO, format } from 'date-fns';
import { createOutboxJob } from '../lib/jobs/outbox.js';
import { createZaloBotMessageIfAbsent } from './messageRepository.js';
import { ZALO_BOT_OUTBOX_JOB_TYPE } from '../../../shared/zaloBot.js';
import type { ZaloBotMessage, ZaloBotLink } from '../../../shared/zaloBot.js';

export async function ensureZaloBotLinkConfirmation(
  db: DocumentStore,
  input: { staffId: string; linkedAt: string }
): Promise<{ messageId: string; ledger: 'created' | 'existing'; jobId: string }> {
  const linkSnap = await db.collection('zalo_bot_links').doc(input.staffId).get();
  if (!linkSnap.exists) {
    throw new Error('LINK_NOT_FOUND');
  }

  const link = linkSnap.data() as ZaloBotLink;

  if (link.status !== 'active' || link.linkedAt !== input.linkedAt) {
    throw new Error('STALE_LINK');
  }

  const confirmationText =
    'Zalo Bot đã liên kết thành công! Bạn sẽ nhận các thông báo từ hệ thống qua ứng dụng này.';

  const epochMs = Date.parse(input.linkedAt);
  const messageId = `link_confirmation_${input.staffId}_${epochMs}`;

  const digestDate = format(parseISO(input.linkedAt), 'yyyy-MM-dd');
  const now = new Date().toISOString();

  const message: ZaloBotMessage = {
    id: messageId,
    staffId: input.staffId,
    role: link.role,
    chatIdHash: link.chatIdHash,
    digestDate,
    messageType: 'link_confirmation',
    contentSnapshot: confirmationText,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  const ledger = await createZaloBotMessageIfAbsent(db, message);
  let shouldCreateJob = true;

  if (ledger === 'existing') {
    const existingSnap = await db.collection('zalo_bot_messages').doc(messageId).get();
    const existing = existingSnap.data() as ZaloBotMessage;
    if (existing && existing.status !== 'pending' && existing.status !== 'failed') {
      shouldCreateJob = false;
    }
  }

  let jobId = `zalo-bot:${messageId}`;
  if (shouldCreateJob) {
    jobId = await createOutboxJob(
      db,
      {
        type: ZALO_BOT_OUTBOX_JOB_TYPE,
        payload: { messageId },
        idempotencyKey: `zalo-bot:${messageId}`,
        maxAttempts: 3,
      },
      {
        actorId: 'webhook:zalo-bot',
        operation: 'zalo_bot:enqueue-link-confirmation',
      }
    );
  }

  return { messageId, ledger, jobId };
}

export async function repairPendingZaloBotLinkConfirmations(
  db: DocumentStore,
  input?: { limit?: number }
): Promise<{ scanned: number; enqueued: number; skipped: number }> {
  const limit = input?.limit ?? 100;

  const querySnap = await db
    .collection('_maintenance')
    .where('confirmationStatus', '==', 'pending')
    .limit(limit)
    .get();

  let scanned = 0;
  let enqueued = 0;
  let skipped = 0;

  for (const doc of querySnap.docs) {
    scanned++;
    const data = doc.data();

    if (data.kind !== 'zalo_bot_webhook') {
      skipped++;
      continue;
    }

    try {
      await ensureZaloBotLinkConfirmation(db, {
        staffId: data.staffId,
        linkedAt: data.linkedAt,
      });

      await doc.ref.update({ confirmationStatus: 'enqueued' });
      enqueued++;
    } catch (err: any) {
      if (err.message === 'STALE_LINK' || err.message === 'LINK_NOT_FOUND') {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  return { scanned, enqueued, skipped };
}
