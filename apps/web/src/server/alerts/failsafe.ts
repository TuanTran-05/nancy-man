import type { FailsafeConfig } from '../config.js';
import { sendCollectorFailureNotice } from './alertService.js';
import { createOpsStore } from '../storage/store.js';
import { captureOpsException } from '../telemetry/runtimeTelemetry.js';
import { resolveConfiguredZaloRecipients, resolveZaloRecipients } from './recipientResolver.js';

export async function runFailsafe(config: FailsafeConfig, fetchImpl?: typeof fetch): Promise<void> {
  let store: ReturnType<typeof createOpsStore> | undefined;
  let recipients = resolveConfiguredZaloRecipients(
    config.zaloRecipientKey,
    config.zaloChatHashSecret,
    config.recipientIds
  );
  try {
    store = createOpsStore(config.dbPath, undefined, config.zaloRecipientKey, {
      busyTimeoutMs: 1_000
    });
    recipients = resolveZaloRecipients(
      store,
      config.zaloRecipientKey,
      config.zaloChatHashSecret,
      config.recipientIds
    );
  } catch (error) {
    captureOpsException(error, {
      code: 'OPS_FAILSAFE_STORE_UNAVAILABLE',
      source: 'job',
      status: 503
    });
    try {
      store?.getDatabaseForBackup().close();
    } catch (closeError) {
      captureOpsException(closeError, {
        code: 'OPS_FAILSAFE_STORE_CLOSE_FAILED',
        source: 'job',
        status: 500
      });
    }
    store = undefined;
  }

  try {
    await sendCollectorFailureNotice(
      {
        botToken: config.zaloBotToken,
        recipients,
        recipientKey: config.zaloRecipientKey,
        timeoutMs: config.zaloTimeoutMs
      },
      fetchImpl
    );
  } finally {
    try {
      store?.getDatabaseForBackup().close();
    } catch (error) {
      captureOpsException(error, {
        code: 'OPS_FAILSAFE_STORE_CLOSE_FAILED',
        source: 'job',
        status: 500
      });
    }
  }
}
