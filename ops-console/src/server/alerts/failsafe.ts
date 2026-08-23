import type { FailsafeConfig } from '../config.js';
import { sendCollectorFailureNotice } from './alertService.js';

export async function runFailsafe(config: FailsafeConfig, fetchImpl?: typeof fetch): Promise<void> {
  await sendCollectorFailureNotice({ botToken: config.zaloBotToken, recipientIds: config.recipientIds, timeoutMs: config.zaloTimeoutMs }, fetchImpl);
}
