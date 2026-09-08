import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadWebConfig } from '../config.js';
import { createOpsStore } from '../storage/store.js';
import { createAuthService } from '../security/auth.js';
import { createOpsApp } from './app.js';
import {
  createRuntimeTelemetry,
  startRuntimeTelemetryMaintenance
} from '../../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
import { installNodeTelemetryLifecycle } from '../../../../../packages/telemetry-sdk/src/nodeLifecycle.js';
import {
  captureOpsException,
  createWebRuntimeTelemetry,
  flushRuntimeTelemetryFailOpen,
  installOpsRuntimeTelemetry
} from '../telemetry/runtimeTelemetry.js';

export function createOpsWebTelemetryStop(input: {
  stopMaintenance: () => void;
  flush: () => Promise<void>;
  disposeNodeTelemetryLifecycle: () => void;
  disposeRuntimeTelemetry: () => void;
}): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () => {
    stopping ??= (async () => {
      input.stopMaintenance();
      try {
        await flushRuntimeTelemetryFailOpen({ flush: input.flush });
      } finally {
        input.disposeNodeTelemetryLifecycle();
        input.disposeRuntimeTelemetry();
      }
    })();
    return stopping;
  };
}

export function startWebServer() {
  const config = loadWebConfig(process.env);
  const telemetryHmac = config.telemetry?.enabled
    ? readFileSync(config.telemetryHmacFile ?? '', 'utf8').trim()
    : undefined;
  if (config.telemetry?.enabled && !telemetryHmac) {
    throw new Error('Ops web telemetry credential is unavailable');
  }
  const telemetry = config.telemetry?.enabled
    ? createWebRuntimeTelemetry({ config: config.telemetry, hmacSecret: telemetryHmac! })
    : createRuntimeTelemetry({
        enabled: false,
        release: '0000000000000000000000000000000000000000',
        service: 'edutrack-ops-web',
        transport: async () => undefined
      });
  const stopTelemetryMaintenance = startRuntimeTelemetryMaintenance({ flush: telemetry.flush });
  const disposeRuntimeTelemetry = installOpsRuntimeTelemetry(telemetry);
  const disposeNodeTelemetryLifecycle = installNodeTelemetryLifecycle({
    captureException: captureOpsException,
    flush: telemetry.flush,
    exit: (code) => process.exit(code)
  });
  const stopRuntimeTelemetry = createOpsWebTelemetryStop({
    stopMaintenance: stopTelemetryMaintenance,
    flush: telemetry.flush,
    disposeNodeTelemetryLifecycle,
    disposeRuntimeTelemetry
  });
  try {
    const legacyMonitoringHmac = readFileSync(config.legacyMonitoringHmacFile, 'utf8').trim();
    if (!legacyMonitoringHmac) {
      throw new Error('Ops legacy monitoring HMAC is unavailable');
    }
    const store = createOpsStore(config.dbPath, undefined, config.zaloRecipientKey);
    const auth = createAuthService({ store, dataKey: config.dataKey });
    const app = createOpsApp({
      store,
      auth,
      staticDir: resolve(process.cwd(), 'dist/web'),
      legacyBrowserApi: process.env.OPS_ENABLE_LEGACY_BROWSER_API === 'true',
      zalo: {
        store,
        auth,
        config: {
          botToken: config.zaloBotToken,
          webhookSecret: config.zaloWebhookSecret,
          linkCodePepper: config.zaloLinkCodePepper,
          chatHashSecret: config.zaloChatHashSecret,
          recipientKey: config.zaloRecipientKey,
          timeoutMs: config.zaloTimeoutMs,
          linkTtlSeconds: config.zaloLinkTtlSeconds
        }
      },
      internalMonitoring: { secret: legacyMonitoringHmac },
      telemetry
    });
    const server = app.listen(config.port, config.listenHost);
    const flushTelemetryOnShutdown = () => {
      void stopRuntimeTelemetry();
    };
    const disposeOnClose = () => {
      process.off('SIGTERM', flushTelemetryOnShutdown);
      process.off('SIGINT', flushTelemetryOnShutdown);
      void stopRuntimeTelemetry();
    };
    process.once('SIGTERM', flushTelemetryOnShutdown);
    process.once('SIGINT', flushTelemetryOnShutdown);
    server.once('close', disposeOnClose);
    return server;
  } catch (error) {
    captureOpsException(error, {
      code: 'OPS_WEB_STARTUP_FAILED',
      source: 'process',
      level: 'fatal'
    });
    void stopRuntimeTelemetry();
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) startWebServer();
