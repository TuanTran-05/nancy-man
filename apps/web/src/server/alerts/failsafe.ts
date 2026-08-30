import type { FailsafeConfig } from '../config.js';
import { sendCollectorFailureNotice } from './alertService.js';
import { createOpsStore } from '../storage/store.js';
import { resolveZaloRecipients } from './recipientResolver.js';

export async function runFailsafe(config: FailsafeConfig, fetchImpl?: typeof fetch): Promise<void> {
  const store = createOpsStore(config.dbPath, undefined, config.zaloRecipientKey);
  await sendCollectorFailureNotice(
    {
      botToken: config.zaloBotToken,
      recipients: resolveZaloRecipients(
        store,
        config.zaloRecipientKey,
        config.zaloChatHashSecret,
        config.recipientIds
      ),
      recipientKey: config.zaloRecipientKey,
      timeoutMs: config.zaloTimeoutMs
    },
    fetchImpl
  );
}
