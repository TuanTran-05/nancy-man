import type { FailsafeConfig } from '../config.js';
import { sendCollectorFailureNotice } from './alertService.js';
import { createOpsStore } from '../storage/store.js';
import { resolveZaloRecipients } from './recipientResolver.js';

export async function runFailsafe(config: FailsafeConfig, fetchImpl?: typeof fetch): Promise<void> {
  const store = createOpsStore(config.dbPath);
  await sendCollectorFailureNotice(
    {
      botToken: config.zaloBotToken,
      recipientIds: resolveZaloRecipients(store, config.zaloRecipientKey, config.recipientIds),
      timeoutMs: config.zaloTimeoutMs
    },
    fetchImpl
  );
}
