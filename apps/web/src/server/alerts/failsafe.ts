import type { FailsafeConfig } from '../config.js';
import { sendCollectorFailureNotice } from './alertService.js';
import { createOpsStore } from '../storage/store.js';
import { resolveZaloRecipientCiphertexts } from './recipientResolver.js';

export async function runFailsafe(config: FailsafeConfig, fetchImpl?: typeof fetch): Promise<void> {
  const store = createOpsStore(config.dbPath, undefined, config.zaloRecipientKey);
  await sendCollectorFailureNotice(
    {
      botToken: config.zaloBotToken,
      recipientCiphertexts: resolveZaloRecipientCiphertexts(
        store,
        config.zaloRecipientKey,
        config.recipientIds
      ),
      recipientKey: config.zaloRecipientKey,
      timeoutMs: config.zaloTimeoutMs
    },
    fetchImpl
  );
}
