import { createOpsApi } from '../index.js';
import { OpsAuthService } from '../modules/auth/authService.js';
import { PostgresOpsAuthRepository } from '../modules/auth/postgresAuthRepository.js';
import { PostgresSqlElevationRepository } from '../modules/auth/postgresSqlElevationRepository.js';
import { PostgresTotpEnrollmentRepository } from '../modules/auth/postgresTotpEnrollmentRepository.js';
import { PostgresStepUpRepository } from '../modules/auth/postgresStepUpRepository.js';
import { StepUpService } from '../modules/auth/stepUpService.js';
import { SqlElevationService } from '../modules/auth/sqlElevation.js';
import { TotpEnrollmentService } from '../modules/auth/totpEnrollment.js';
import { PostgresIssueInbox } from '../modules/issues/postgresIssueInbox.js';
import { PostgresIssueWorkflow } from '../modules/issues/postgresIssueWorkflow.js';
import { PostgresIncidentStore } from '../modules/incidents/postgresIncidentStore.js';
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
import { AccountService } from '../modules/accounts/accountService.js';
import { PostgresAccountRepository } from '../modules/accounts/postgresAccountRepository.js';
import { createHash } from 'node:crypto';
import { LegacyMonitoringClient } from '../modules/monitoring/legacyMonitoringClient.js';
import { ConfigAgentClient } from '../infrastructure/configAgentClient.js';
import { StepUpError, type StepUpBinding } from '../modules/auth/stepUpService.js';
import type { Catalog } from '../../../../packages/config-contracts/src/catalog.js';
import { VariablesService } from '../modules/variables/variablesService.js';

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
  passwordFingerprintPepper: string;
  legacyMonitoringHmacSecret: string;
  mfaEncryptionKey: Buffer;
  sqlWorker?: { socketPath: string; hmacSecret: string; auditEncryptionKey: Buffer };
  configAgent?: { client: ConfigAgentClient; catalog: Catalog };
  resolveSecret: (reference: string) => Promise<string | null>;
}): { app: ReturnType<typeof createOpsApi> } {
  const ingestStore = new PostgresIngestStore(input.database);
  const sessionRepository = new OpsSessionRepository(input.database, input.authSessionPepper);
  const stepUpRepository = new PostgresStepUpRepository(input.database);
  const stepUpService = new StepUpService({
    repository: stepUpRepository,
    encryptionKey: input.mfaEncryptionKey
  });
  const accountAuthorization = new Map<
    string,
    { grantId: string; userId: string; sessionId: string; ipHash: string; userAgentHash: string; capability: 'accounts_write' }
  >();
  const accountService = new AccountService({
    repository: new PostgresAccountRepository(input.database),
    stepUp: stepUpService,
    audit: new PostgresOpsAuditLedger({ database: input.database })
  });
  const monitoringClient = new LegacyMonitoringClient({ secret: input.legacyMonitoringHmacSecret });
  const variablesAuthorization = new Map<string, StepUpBinding>();
  const variableUnlockWindows = new Map<string, { startedAt: number; count: number }>();
  const variableUnlockRateLimiter = {
    allow: async (value: { userId: string; sessionId: string; ipHash: string }): Promise<boolean> => {
      const now = Date.now();
      const key = `${value.userId}:${value.sessionId}:${value.ipHash}`;
      const current = variableUnlockWindows.get(key);
      if (!current || current.startedAt + 15 * 60 * 1_000 <= now) {
        variableUnlockWindows.set(key, { startedAt: now, count: 1 });
        return true;
      }
      if (current.count >= 5) return false;
      current.count += 1;
      return true;
    }
  };
  const variableStepUp = {
    grant: async (proof: {
      capability: 'variables_secret';
      userId: string;
      sessionId: string;
      password: string;
      totpCode: string;
      ipHash: string;
      userAgentHash: string;
    }) => {
      const { rows } = await input.database.query<{ id: string }>(
        `SELECT id FROM ops_mfa_factors
         WHERE user_id = $1 AND factor_type = 'totp' AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [proof.userId]
      );
      const factorId = rows[0]?.id;
      if (!factorId) throw new StepUpError('STEP_UP_INVALID');
      const grant = await stepUpService.grant({
        capability: proof.capability,
        userId: proof.userId,
        sessionId: proof.sessionId,
        password: proof.password,
        factorId,
        token: proof.totpCode,
        ipHash: proof.ipHash,
        userAgentHash: proof.userAgentHash
      });
      variablesAuthorization.set(proof.sessionId, {
        grantId: grant.id,
        capability: grant.capability,
        userId: grant.userId,
        sessionId: grant.sessionId,
        ipHash: grant.ipHash,
        userAgentHash: grant.userAgentHash
      });
      return { id: grant.id, expiresAt: grant.expiresAt };
    },
    authorize: (binding: StepUpBinding) => stepUpService.authorize(binding),
    revoke: (binding: StepUpBinding) => stepUpService.revoke(binding)
  };
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
  const sqlExecutionStore = input.sqlWorker
    ? new PostgresSqlExecutionStore(input.database)
    : undefined;
  const sqlPreview =
    input.sqlWorker && sqlWorker && sqlExecutionStore
      ? new SqlReadPreviewService({
          elevation: sqlElevationRepository,
          executionStore: sqlExecutionStore,
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
          passwordFingerprintPepper: input.passwordFingerprintPepper,
          repository: new PostgresTotpEnrollmentRepository(input.database)
        }),
        stepUp: {
          grant: async (proof) => {
            const grant = await stepUpService.grant(proof);
            accountAuthorization.set(grant.sessionId, {
              grantId: grant.id,
              userId: grant.userId,
              sessionId: grant.sessionId,
              ipHash: grant.ipHash,
              userAgentHash: grant.userAgentHash,
              capability: 'accounts_write'
            });
            return { id: grant.id, expiresAt: grant.expiresAt };
          }
        }
      },
      accounts: {
        service: accountService,
        session: {
          authorize: (request) =>
            authorizeOpsSession({
              ...request,
              sessionPepper: input.authSessionPepper,
              repository: sessionRepository
            })
        },
        resolveAuthorization: (principal, request) => {
          const stored = accountAuthorization.get(principal.sessionId);
          if (!stored) return null;
          const userAgent = request.get('user-agent') ?? 'unknown';
          return {
            ...stored,
            ipHash: createHash('sha256')
              .update(`${request.ip || request.socket.remoteAddress || 'unknown'}${input.rateLimitPepper}`)
              .digest('hex'),
            userAgentHash: createHash('sha256').update(userAgent, 'utf8').digest('hex')
          };
        }
      },
      monitoring: {
        client: monitoringClient,
        session: {
          authorize: (request) =>
            authorizeOpsSession({
              ...request,
              sessionPepper: input.authSessionPepper,
              repository: sessionRepository
            })
        }
      },
      ...(input.configAgent
        ? {
            variables: {
              service: new VariablesService({
                client: input.configAgent.client,
                catalog: input.configAgent.catalog,
                audit: new PostgresOpsAuditLedger({ database: input.database })
              }),
              session: {
                authorize: (request: {
                  cookieHeader?: string;
                  csrfToken?: string;
                  mutation: boolean;
                }) =>
                  authorizeOpsSession({
                    ...request,
                    sessionPepper: input.authSessionPepper,
                    repository: sessionRepository
                  })
              },
              stepUp: variableStepUp,
              hashClientIp: (ip: string) =>
                createHash('sha256').update(`${ip}${input.rateLimitPepper}`).digest('hex'),
              rateLimiter: variableUnlockRateLimiter
            }
          }
        : {}),
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
      incidents: {
        authorize: (request) =>
          authorizeOpsSession({
            ...request,
            sessionPepper: input.authSessionPepper,
            repository: sessionRepository
          }),
        incidents: new PostgresIncidentStore(input.database)
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
              ...(sqlPreview ? { preview: sqlPreview } : {}),
              ...(sqlExecutionStore ? { history: sqlExecutionStore } : {})
            }
          }
        : {}),
      trustedProxy: 'loopback'
    })
  };
}
