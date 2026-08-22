import { createOpsApi } from '../index.js';
import { OpsAuthService } from '../modules/auth/authService.js';
import { PostgresOpsAuthRepository } from '../modules/auth/postgresAuthRepository.js';
import { PostgresSqlElevationRepository } from '../modules/auth/postgresSqlElevationRepository.js';
import { PostgresTotpEnrollmentRepository } from '../modules/auth/postgresTotpEnrollmentRepository.js';
import { SqlElevationService } from '../modules/auth/sqlElevation.js';
import { TotpEnrollmentService } from '../modules/auth/totpEnrollment.js';
import { PostgresIssueInbox } from '../modules/issues/postgresIssueInbox.js';
import { PostgresIssueWorkflow } from '../modules/issues/postgresIssueWorkflow.js';
import { authorizeOpsSession } from '../modules/auth/sessionAuthorization.js';
import { OpsSessionRepository } from '../../../../packages/db/src/repositories/opsSessions.js';
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
import { PostgresOpsAuditLedger } from '../modules/audit/postgresAuditLedger.js';
import { PostgresSqlExecutionStore } from '../modules/sql/postgresSqlExecutionStore.js';
import { SqlReadPreviewService } from '../modules/sql/readPreviewService.js';
import { SqlWorkerClient } from '../modules/sql/workerClient.js';

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
  sqlWorker?: { socketPath: string; hmacSecret: string; auditEncryptionKey: Buffer };
  resolveSecret: (reference: string) => Promise<string | null>;
}): { app: ReturnType<typeof createOpsApi> } {
  const ingestStore = new PostgresIngestStore(input.database);
  const sessionRepository = new OpsSessionRepository(input.database, input.authSessionPepper);
  const sqlElevationRepository = new PostgresSqlElevationRepository(input.database);
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
  const sqlWorker = input.sqlWorker
    ? new SqlWorkerClient({
        socketPath: input.sqlWorker.socketPath,
        secret: input.sqlWorker.hmacSecret
      })
    : undefined;
  const sqlPreview =
    input.sqlWorker && sqlWorker
      ? new SqlReadPreviewService({
          elevation: sqlElevationRepository,
          executionStore: new PostgresSqlExecutionStore(input.database),
          audit: new PostgresOpsAuditLedger({ database: input.database }),
          worker: sqlWorker,
          encryptionKey: input.sqlWorker.auditEncryptionKey
        })
      : undefined;

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
          createHash('sha256').update(`${ip}${input.rateLimitPepper}`).digest('hex'),
        session: {
          authorize: (request) =>
            authorizeOpsSession({
              ...request,
              sessionPepper: input.authSessionPepper,
              repository: sessionRepository
            }),
          revoke: (sessionId) => sessionRepository.revokeById(sessionId, 'LOGOUT')
        },
        sqlElevation: new SqlElevationService({
          repository: sqlElevationRepository,
          encryptionKey: input.mfaEncryptionKey
        }),
        bootstrap: new TotpEnrollmentService({
          encryptionKey: input.mfaEncryptionKey,
          repository: new PostgresTotpEnrollmentRepository(input.database)
        })
      },
      issues: {
        authorize: (request) =>
          authorizeOpsSession({
            ...request,
            sessionPepper: input.authSessionPepper,
            repository: sessionRepository
          }),
        inbox: new PostgresIssueInbox(input.database),
        workflow: new PostgresIssueWorkflow(input.database)
      },
      ...(sqlWorker
        ? {
            database: {
              authorize: (request) =>
                authorizeOpsSession({
                  ...request,
                  sessionPepper: input.authSessionPepper,
                  repository: sessionRepository
                }),
              worker: sqlWorker
            },
            sql: {
              authorize: (request) =>
                authorizeOpsSession({
                  ...request,
                  sessionPepper: input.authSessionPepper,
                  repository: sessionRepository
                }),
              worker: sqlWorker,
              ...(sqlPreview ? { preview: sqlPreview } : {})
            }
          }
        : {}),
      trustedProxy: 'loopback'
    })
  };
}
import { createHash } from 'node:crypto';
