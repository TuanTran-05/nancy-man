import { createOpsApi } from '../index.js';
import { OpsAuthService } from '../modules/auth/authService.js';
import { PostgresOpsAuthRepository } from '../modules/auth/postgresAuthRepository.js';
import { createBrowserIngestService } from '../modules/ingest/browserIngest.js';
import { PostgresBrowserRateLimiter } from '../modules/ingest/postgresBrowserRateLimiter.js';
import { PostgresIngestStore } from '../modules/ingest/postgresIngestStore.js';
import { PostgresNonceStore } from '../modules/ingest/postgresNonceStore.js';
import { createServerIngestService } from '../modules/ingest/serverIngest.js';
import { FileObjectStore } from '../modules/releases/fileObjectStore.js';
import {
  PostgresReleasePublisherStore,
  PostgresReleaseRepository
} from '../modules/releases/postgresReleaseStore.js';
import { createReleasePublisherService } from '../modules/releases/releasePublisher.js';
import { registerRelease } from '../modules/releases/releaseService.js';

import { type TransactionalQueryDatabase } from './poolDatabase.js';
import { type OpsRuntimeConfig } from './runtimeConfig.js';

export type OpsRuntimeDatabase = TransactionalQueryDatabase;

export function createOpsApiRuntime(input: {
  config: OpsRuntimeConfig;
  database: OpsRuntimeDatabase;
  sessionPepper: string;
  rateLimitPepper: string;
  browserContextKey: string;
  authSessionPepper: string;
  mfaEncryptionKey: Buffer;
  resolveSecret: (reference: string) => Promise<string | null>;
}): { app: ReturnType<typeof createOpsApi> } {
  const ingestStore = new PostgresIngestStore(input.database);
  const nonceStore = new PostgresNonceStore(input.database);
  const browser = createBrowserIngestService({
    store: ingestStore,
    sessionPepper: input.sessionPepper,
    browserContextKeyring: { [input.config.browserContextKey.id]: input.browserContextKey },
    rateLimiter: new PostgresBrowserRateLimiter({
      database: input.database,
      pepper: input.rateLimitPepper
    })
  });
  const server = createServerIngestService({
    store: ingestStore,
    nonceStore,
    resolveSecret: input.resolveSecret,
    sessionPepper: input.sessionPepper
  });
  const objectStore = new FileObjectStore(input.config.objectStoreDirectory);
  const releases = createReleasePublisherService({
    publishers: new PostgresReleasePublisherStore(input.database),
    nonceStore,
    resolveSecret: input.resolveSecret,
    registerRelease: (manifest) =>
      registerRelease(manifest, {
        objectStore,
        repository: new PostgresReleaseRepository(input.database)
      })
  });

  return {
    app: createOpsApi({
      ingest: { browser, server, browserCorsOrigins: input.config.browserCorsOrigins },
      releases,
      auth: {
        service: new OpsAuthService({
          repository: new PostgresOpsAuthRepository(input.database),
          sessionPepper: input.authSessionPepper,
          mfaEncryptionKey: input.mfaEncryptionKey
        }),
        hashClientIp: (ip) =>
          createHash('sha256').update(`${ip}${input.rateLimitPepper}`).digest('hex')
      },
      trustedProxy: 'loopback'
    })
  };
}
import { createHash } from 'node:crypto';
