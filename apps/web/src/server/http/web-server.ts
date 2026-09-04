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
import { createWebRuntimeTelemetry } from '../telemetry/runtimeTelemetry.js';

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
  installNodeTelemetryLifecycle({
    captureException: telemetry.captureException,
    flush: telemetry.flush,
    exit: (code) => process.exit(code)
  });
  const legacyMonitoringHmac = readFileSync(config.legacyMonitoringHmacFile, 'utf8').trim();
  if (!legacyMonitoringHmac) {
    const error = new Error('Ops legacy monitoring HMAC is unavailable');
    telemetry.captureException(error, {
      code: 'OPS_WEB_CREDENTIALS_UNAVAILABLE',
      source: 'process',
      level: 'fatal'
    });
    void telemetry.flush().catch(() => undefined);
    stopTelemetryMaintenance();
    throw error;
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
    stopTelemetryMaintenance();
    void telemetry.flush().catch(() => undefined);
  };
  process.once('SIGTERM', flushTelemetryOnShutdown);
  process.once('SIGINT', flushTelemetryOnShutdown);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startWebServer();
