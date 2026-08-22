import { DocumentStore, FieldValue } from '@/server/db/documentStore.js';
import { ZaloBotConfig } from './config.js';
import { collectZaloBotDigestSources } from './digestSources.js';
import { buildZaloBotDigestPlan } from './digestRules.js';
import { composeZaloBotDigest } from './digestComposer.js';
import {
  makeZaloBotDailyMessageId,
  ZALO_BOT_OUTBOX_JOB_TYPE,
  ZaloBotMessage,
} from '../../../shared/zaloBot.js';
import { createZaloBotMessageIfAbsent } from './messageRepository.js';
import { createOutboxJob } from '../lib/jobs/outbox.js';

export async function runZaloBotDailyDigest(
  db: DocumentStore,
  input: {
    digestDate: string;
    tomorrowDate: string;
    config: ZaloBotConfig;
  }
): Promise<{
  digestDate: string;
  dryRun: boolean;
  recipients: number;
  enqueued: number;
  existing: number;
  skipped: number;
}> {
  if (!input.config.dailyDigestEnabled) {
    return {
      digestDate: input.digestDate,
      dryRun: input.config.dryRun,
      recipients: 0,
      enqueued: 0,
      existing: 0,
      skipped: 0,
    };
  }

  const sources = await collectZaloBotDigestSources(db, {
    digestDate: input.digestDate,
    tomorrowDate: input.tomorrowDate,
  });

  const plan = buildZaloBotDigestPlan(sources);

  let enqueued = 0;
  let existing = 0;
  let skipped = 0;

  const now = new Date().toISOString();

  const chatIdHashMap = new Map<string, string>();
  for (const rcpt of sources.activeRecipients) {
    chatIdHashMap.set(rcpt.staffId, rcpt.chatIdHash);
  }

  for (const [staffId, recipient] of plan.entries()) {
    const messageId = makeZaloBotDailyMessageId(input.digestDate, staffId);
    const content = composeZaloBotDigest(recipient, {
      digestDate: input.digestDate,
      appUrl: input.config.appUrl,
      dryRun: input.config.dryRun,
    });

    const chatIdHash = chatIdHashMap.get(staffId) || '';

    const message: ZaloBotMessage = {
      id: messageId,
      staffId,
      role: recipient.role,
      chatIdHash,
      digestDate: input.digestDate,
      messageType: 'daily_digest',
      contentSnapshot: content,
      status: input.config.dryRun ? 'skipped' : 'pending',
      attempts: 0,
      errorCode: input.config.dryRun ? 'dry_run' : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const result = await createZaloBotMessageIfAbsent(db, message);

    if (result === 'existing') {
      existing++;
    }

    if (input.config.dryRun) {
      skipped++;
      continue;
    }

    const snap = await db.collection('zalo_bot_messages').doc(messageId).get();
    const ledgerMsg = snap.data() as ZaloBotMessage;

    if (ledgerMsg && (ledgerMsg.status === 'pending' || ledgerMsg.status === 'failed')) {
      await createOutboxJob(
        db,
        {
          type: ZALO_BOT_OUTBOX_JOB_TYPE,
          payload: { messageId },
          idempotencyKey: `zalo-bot:${messageId}`,
          maxAttempts: 3,
        },
        {
          actorId: `job:zalo-bot-digest:${input.digestDate}`,
          operation: 'zalo_bot:enqueue-daily-digest',
        }
      );
      enqueued++;
    } else {
      skipped++;
    }
  }

  await db.collection('_maintenance').doc(`zaloBotDigest_${input.digestDate}`).set(
    {
      digestDate: input.digestDate,
      recipients: plan.size,
      enqueued,
      existing,
      skipped,
      completedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    digestDate: input.digestDate,
    dryRun: input.config.dryRun,
    recipients: plan.size,
    enqueued,
    existing,
    skipped,
  };
}
