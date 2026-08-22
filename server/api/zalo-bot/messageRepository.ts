import { DocumentStore, FieldValue } from '@/server/db/documentStore.js';
import { ZaloBotMessage } from '../../../shared/zaloBot.js';

export async function createZaloBotMessageIfAbsent(
  db: DocumentStore,
  message: ZaloBotMessage
): Promise<'created' | 'existing'> {
  const ref = db.collection('zalo_bot_messages').doc(message.id);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        return 'existing';
      }
      tx.set(ref, message);
      return 'created';
    });
  } catch (err) {
    throw err;
  }
}

export async function claimZaloBotMessageForDelivery(
  db: DocumentStore,
  input: { messageId: string; lockerId: string; now: string }
): Promise<'claimed' | 'busy' | 'terminal' | 'missing'> {
  const ref = db.collection('zalo_bot_messages').doc(input.messageId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return 'missing';
    }

    const data = snap.data() as ZaloBotMessage;

    if (data.status === 'sent' || data.status === 'skipped') {
      return 'terminal';
    }

    if (data.status === 'processing') {
      if (data.processingStartedAt) {
        const startedAt = new Date(data.processingStartedAt).getTime();
        const nowMs = new Date(input.now).getTime();
        const diff = nowMs - startedAt;

        if (diff <= 5 * 60 * 1000) {
          return 'busy';
        }
      }
    }

    tx.update(ref, {
      status: 'processing',
      processingStartedAt: input.now,
      lockedBy: input.lockerId,
      updatedAt: input.now,
    });

    return 'claimed';
  });
}

export async function beginZaloBotProviderAttempt(
  db: DocumentStore,
  input: { messageId: string; lockerId: string; now: string }
): Promise<{ attempt: number }> {
  const ref = db.collection('zalo_bot_messages').doc(input.messageId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error(`Message not found: ${input.messageId}`);
    }

    const data = snap.data() as ZaloBotMessage;

    if (data.lockedBy !== input.lockerId) {
      throw new Error(`Message ${input.messageId} is not locked by ${input.lockerId}`);
    }

    const nextAttempt = (data.attempts || 0) + 1;

    tx.update(ref, {
      attempts: nextAttempt,
      lastAttemptAt: input.now,
      updatedAt: input.now,
    });

    return { attempt: nextAttempt };
  });
}

export async function updateZaloBotMessageSent(
  db: DocumentStore,
  input: { messageId: string; lockerId: string; providerMessageId: string; now: string }
): Promise<void> {
  const ref = db.collection('zalo_bot_messages').doc(input.messageId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const data = snap.data() as ZaloBotMessage;
    if (data.lockedBy !== input.lockerId) {
      throw new Error(`Message ${input.messageId} is not locked by ${input.lockerId}`);
    }

    tx.update(ref, {
      status: 'sent',
      providerMessageId: input.providerMessageId,
      lockedBy: FieldValue.delete(),
      processingStartedAt: FieldValue.delete(),
      updatedAt: input.now,
    });
  });
}

export async function updateZaloBotMessageFailed(
  db: DocumentStore,
  input: {
    messageId: string;
    lockerId: string;
    errorCode: string;
    errorMessage: string;
    deliveryAmbiguous?: boolean;
    now: string;
    nextAttemptAt?: string;
  }
): Promise<void> {
  const ref = db.collection('zalo_bot_messages').doc(input.messageId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const data = snap.data() as ZaloBotMessage;
    if (data.lockedBy !== input.lockerId) {
      throw new Error(`Message ${input.messageId} is not locked by ${input.lockerId}`);
    }

    const updates: Record<string, any> = {
      status: 'failed',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      lockedBy: FieldValue.delete(),
      processingStartedAt: FieldValue.delete(),
      updatedAt: input.now,
    };

    if (input.deliveryAmbiguous !== undefined) {
      updates.deliveryAmbiguous = input.deliveryAmbiguous;
    }
    if (input.nextAttemptAt) {
      updates.nextAttemptAt = input.nextAttemptAt;
    }

    tx.update(ref, updates);
  });
}

export async function updateZaloBotMessageSkipped(
  db: DocumentStore,
  input: {
    messageId: string;
    lockerId: string;
    errorCode: string;
    errorMessage: string;
    now: string;
  }
): Promise<void> {
  const ref = db.collection('zalo_bot_messages').doc(input.messageId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const data = snap.data() as ZaloBotMessage;
    if (data.lockedBy !== input.lockerId) {
      throw new Error(`Message ${input.messageId} is not locked by ${input.lockerId}`);
    }

    tx.update(ref, {
      status: 'skipped',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      lockedBy: FieldValue.delete(),
      processingStartedAt: FieldValue.delete(),
      updatedAt: input.now,
    });
  });
}
