import { resolve } from 'node:path';
import { loadWebConfig } from '../config.js';
import { createOpsStore } from '../storage/store.js';
import { createAuthService } from '../security/auth.js';
import { createOpsApp } from './app.js';

export function startWebServer() {
  const config = loadWebConfig(process.env);
  const store = createOpsStore(config.dbPath);
  const auth = createAuthService({ store, dataKey: config.dataKey });
  const app = createOpsApp({
    store,
    auth,
    staticDir: resolve(process.cwd(), 'dist/web'),
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
        linkTtlSeconds: config.zaloLinkTtlSeconds,
      },
    },
  });
  return app.listen(config.port, config.listenHost);
}

if (import.meta.url === `file://${process.argv[1]}`) startWebServer();
