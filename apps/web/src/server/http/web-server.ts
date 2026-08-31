import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadWebConfig } from '../config.js';
import { createOpsStore } from '../storage/store.js';
import { createAuthService } from '../security/auth.js';
import { createOpsApp } from './app.js';

export function startWebServer() {
  const config = loadWebConfig(process.env);
  const legacyMonitoringHmac = readFileSync(config.legacyMonitoringHmacFile, 'utf8').trim();
  if (!legacyMonitoringHmac) throw new Error('Ops legacy monitoring HMAC is unavailable');
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
    internalMonitoring: { secret: legacyMonitoringHmac }
  });
  return app.listen(config.port, config.listenHost);
}

if (import.meta.url === `file://${process.argv[1]}`) startWebServer();
