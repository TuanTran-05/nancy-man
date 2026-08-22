import { DocumentStore, FieldValue } from '@/server/db/documentStore.js';
import { ZaloBotConfig } from './config.js';
import { sendZaloBotText, ZaloBotApiError } from './botClient.js';
import {
  claimZaloBotMessageForDelivery,
  beginZaloBotProviderAttempt,
  updateZaloBotMessageSent,
  updateZaloBotMessageFailed,
  updateZaloBotMessageSkipped,
} from './messageRepository.js';
import { markZaloBotLinkNeedsRelink } from './linkRepository.js';
import { OutboxHandlerError } from '../lib/jobs/outbox.js';
import { ZaloBotMessage, ZaloBotLink, ZALO_BOT_STAFF_ROLES } from '../../../shared/zaloBot.js';
import { randomUUID, createHmac } from 'crypto';

export type DeliveryDependencies = {
  config: ZaloBotConfig;
  sendText: typeof sendZaloBotText;
};

export async function deliverZaloBotMessage(
  db: DocumentStore,
  input: { messageId: string },
  deps: DeliveryDependencies
): Promise<void> {
  const lockerId = randomUUID();
  const now = new Date().toISOString();

  // 1. Claim/reclaim the ledger
  const claimResult = await claimZaloBotMessageForDelivery(db, {
    messageId: input.messageId,
    lockerId,
    now,
  });

  if (claimResult === 'busy' || claimResult === 'terminal') {
    return;
  }
  if (claimResult === 'missing') {
    throw new Error(`Message not found: ${input.messageId}`);
  }

  // Load message
  const msgSnap = await db.collection('zalo_bot_messages').doc(input.messageId).get();
  const message = msgSnap.data() as ZaloBotMessage;

  // 2. Reload link and current user
  const linkSnap = await db.collection('zalo_bot_links').doc(message.staffId).get();
  const userSnap = await db.collection('users').doc(message.staffId).get();

  const link = linkSnap.data() as ZaloBotLink | undefined;
  const user = userSnap.data() as any;

  // 3. Check skip conditions
  let skipReason: string | null = null;
  if (!link || link.status !== 'active') {
    skipReason = 'Link missing or not active';
  } else if (!user || user.blockedTeacher === true) {
    skipReason = 'User missing or blocked';
  } else if (!ZALO_BOT_STAFF_ROLES.includes(user.role)) {
    skipReason = 'User role ineligible';
  } else if (user.role !== link.role) {
    skipReason = 'User role mismatch with link';
  }

  if (!deps.config.enabled || deps.config.dryRun) {
    skipReason = skipReason || 'Zalo bot disabled or in dry run';
  }

  if (skipReason) {
    await updateZaloBotMessageSkipped(db, {
      messageId: input.messageId,
      lockerId,
      errorCode: 'ineligible',
      errorMessage: skipReason,
      now: new Date().toISOString(),
    });
    return;
  }

  // 4. Call beginZaloBotProviderAttempt
  await beginZaloBotProviderAttempt(db, {
    messageId: input.messageId,
    lockerId,
    now: new Date().toISOString(),
  });

  // 5. Send message
  try {
    const result = await deps.sendText(
      { chatId: link!.chatId, text: message.contentSnapshot },
      deps.config
    );

    await updateZaloBotMessageSent(db, {
      messageId: input.messageId,
      lockerId,
      providerMessageId: result.messageId,
      now: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const apiErr =
      err instanceof ZaloBotApiError
        ? err
        : new ZaloBotApiError(
            err instanceof Error ? err.message : String(err),
            'transient',
            0,
            0,
            true
          );

    const errorNow = new Date().toISOString();

    if (apiErr.kind === 'invalid_chat') {
      await updateZaloBotMessageSkipped(db, {
        messageId: input.messageId,
        lockerId,
        errorCode: 'invalid_chat',
        errorMessage: 'Invalid or missing chat',
        now: errorNow,
      });

      const hmac = (secret: string, data: string) =>
        createHmac('sha256', secret).update(data).digest('hex');

      await markZaloBotLinkNeedsRelink(
        db,
        { chatId: link!.chatId },
        {
          now: () => new Date().toISOString(),
          generateCode: () => '', // not used
          hmac,
          config: deps.config,
        }
      );
      return;
    }

    if (apiErr.kind === 'auth') {
      await updateZaloBotMessageFailed(db, {
        messageId: input.messageId,
        lockerId,
        errorCode: 'auth',
        errorMessage: 'Zalo Bot authentication failed',
        now: errorNow,
      });

      // Critical admin notification
      const incidentId = `zalo_bot_auth_${message.digestDate}`;
      await db.collection('admin_notifications').doc(incidentId).set({
        type: 'zalo_bot_auth_error',
        message: 'Zalo Bot token authentication failed (401)',
        digestDate: message.digestDate,
        createdAt: errorNow,
        read: false,
      });

      throw new OutboxHandlerError('Zalo Bot Auth Error', { retryable: true, abortBatch: true });
    }

    if (apiErr.kind === 'rate_limited') {
      await updateZaloBotMessageFailed(db, {
        messageId: input.messageId,
        lockerId,
        errorCode: 'rate_limited',
        errorMessage: 'Rate limited by Zalo API',
        now: errorNow,
      });
      throw new OutboxHandlerError('Zalo Bot Rate Limited', {
        retryable: true,
        abortBatch: false,
        retryAfterMs: apiErr.retryAfterMs,
      });
    }

    if (apiErr.kind === 'transient') {
      await updateZaloBotMessageFailed(db, {
        messageId: input.messageId,
        lockerId,
        errorCode: 'transient',
        errorMessage: apiErr.message,
        deliveryAmbiguous: apiErr.deliveryAmbiguous,
        now: errorNow,
      });
      throw new OutboxHandlerError(apiErr.message, { retryable: true, abortBatch: false });
    }

    // permanent
    await updateZaloBotMessageFailed(db, {
      messageId: input.messageId,
      lockerId,
      errorCode: 'permanent',
      errorMessage: apiErr.message,
      now: errorNow,
    });
    throw new OutboxHandlerError(apiErr.message, { retryable: false, abortBatch: false });
  }
}
