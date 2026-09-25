import { FileSecretResolver } from '../../../../packages/security/src/fileSecretResolver.js';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import {
  createRuntimeTelemetry,
  startRuntimeTelemetryMaintenance,
  type RuntimeTelemetry
} from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
import { installNodeTelemetryLifecycle } from '../../../../packages/telemetry-sdk/src/nodeLifecycle.js';
import {
  captureOpsException,
  createSqlWorkerRuntimeTelemetry,
  flushRuntimeTelemetryFailOpen,
  installOpsRuntimeTelemetry
} from '../telemetry/runtimeTelemetry.js';

import {
  assertProductionReadIdentity,
  assertTlsProtectedPostgresUrl,
  createReadPreviewer
} from '../database/readPool.js';
import {
  assertProductionMutationIdentity,
  createMutationPreviewer
} from '../database/mutationPool.js';
import { createProductionSchemaReader } from '../schema/introspectSchema.js';
import { createExplorerSchemaReader } from '../explorer/schemaReader.js';
import { readDatabaseRows } from '../explorer/rowReader.js';
import { readRelatedRows } from '../explorer/relatedRowReader.js';
import type { DatabasePolicyApproval } from '../explorer/policyApproval.js';
import { startWorkerProtocolServer } from '../protocol/server.js';
import { createSqlWorkerCommandHandler } from './commandHandler.js';
import { createExpiringNonceStore } from './nonceStore.js';
import type { DatabaseTargetId } from '../../../../packages/contracts/src/databaseExplorer.js';
import type { DatabaseExplorerSchemaSnapshot } from '../../../../packages/contracts/src/databaseExplorer.js';
import { createTargetRegistry, type TargetEntry } from '../database/targetRegistry.js';
import { isValidCursorKey } from '../explorer/cursorCodec.js';
import type { DatabaseTargetConfig, SqlWorkerRuntimeConfig } from './runtimeConfig.js';
import { readSqlWorkerRuntimeConfig } from './runtimeConfig.js';

type TargetCredentials =
  | { enabled: false }
  | {
      enabled: true;
      databaseUrl: string;
      databaseName: string;
      role: string;
    };

type ExplorerCredentials =
  | { enabled: false }
  | {
      enabled: true;
      cursorKey: string;
      policyApproval: string;
      targets: {
        edutrack_production: TargetCredentials;
        ops: TargetCredentials;
      };
    };

type SqlWorkerCredentials = {
  hmacSecret: string;
  read:
    | { enabled: false }
    | {
        enabled: true;
        databaseUrl: string;
        databaseName: string;
        role: string;
      };
  mutation:
    | { enabled: false }
    | {
        enabled: true;
        databaseUrl: string;
        databaseName: string;
        role: string;
      };
  explorer: ExplorerCredentials;
};

type ProductionReadPool = {
  query: <T>(
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
  connect: () => Promise<{
    query: <T>(
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: T[]; rowCount?: number | null }>;
    release: () => void;
  }>;
  end: () => Promise<void>;
};

type ProductionMutationPool = ProductionReadPool;

function createProductionReadPool(databaseUrl: string): ProductionReadPool {
  return new Pool({
    connectionString: databaseUrl,
    application_name: 'edutrack-ops-read',
    max: 2,
    idleTimeoutMillis: 30_000
  });
}

function createProductionMutationPool(databaseUrl: string): ProductionMutationPool {
  return new Pool({
    connectionString: databaseUrl,
    application_name: 'edutrack-ops-mutation-preview',
    max: 1,
    idleTimeoutMillis: 30_000
  });
}

function createExplorerTargetPool(targetId: string, databaseUrl: string): ProductionReadPool {
  return new Pool({
    connectionString: databaseUrl,
    application_name: `edutrack-ops-database-explorer:${targetId}`,
    max: 2,
    idleTimeoutMillis: 30_000
  });
}

function parsePolicyApproval(serialized: string): DatabasePolicyApproval | undefined {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as { version?: unknown; targets?: unknown };
    if (
      typeof candidate.version !== 'string' ||
      !candidate.targets ||
      typeof candidate.targets !== 'object' ||
      Array.isArray(candidate.targets)
    ) {
      return undefined;
    }
    return candidate as DatabasePolicyApproval;
  } catch {
    return undefined;
  }
}

export async function resolveSqlWorkerCredentials(input: {
  config: SqlWorkerRuntimeConfig;
  resolveSecret: (reference: string) => Promise<string | null>;
}): Promise<SqlWorkerCredentials> {
  const hmacSecret = await input.resolveSecret(input.config.hmacSecretReference);
  if (!hmacSecret) throw new Error('SQL worker runtime credentials are unavailable');
  let read: SqlWorkerCredentials['read'] = { enabled: false };
  if (input.config.read.enabled) {
    const databaseUrl = await input.resolveSecret(input.config.read.databaseUrlReference);
    if (!databaseUrl) throw new Error('SQL worker runtime credentials are unavailable');
    read = {
      enabled: true,
      databaseUrl,
      databaseName: input.config.read.databaseName,
      role: input.config.read.role
    };
  }
  let mutation: SqlWorkerCredentials['mutation'] = { enabled: false };
  if (input.config.mutation.enabled) {
    const databaseUrl = await input.resolveSecret(input.config.mutation.databaseUrlReference);
    if (!databaseUrl) throw new Error('SQL worker runtime credentials are unavailable');
    mutation = {
      enabled: true,
      databaseUrl,
      databaseName: input.config.mutation.databaseName,
      role: input.config.mutation.role
    };
  }
  let explorer: ExplorerCredentials = { enabled: false };
  if (input.config.explorer.enabled) {
    const cursorKey = await input.resolveSecret(input.config.explorer.cursorKeyReference);
    if (!isValidCursorKey(cursorKey)) {
      throw new Error('SQL worker runtime credentials are unavailable');
    }
    const policyApproval = await input.resolveSecret(input.config.explorer.policyApprovalReference);
    if (!policyApproval) throw new Error('SQL worker runtime credentials are unavailable');

    const resolveTarget = async (
      targetConfig: DatabaseTargetConfig
    ): Promise<TargetCredentials> => {
      if (!targetConfig.enabled) return { enabled: false };
      const databaseUrl = await input.resolveSecret(targetConfig.databaseUrlReference);
      if (!databaseUrl) throw new Error('SQL worker runtime credentials are unavailable');
      return {
        enabled: true,
        databaseUrl,
        databaseName: targetConfig.databaseName,
        role: targetConfig.role
      };
    };

    const edutrack = await resolveTarget(input.config.explorer.targets.edutrack_production);
    const ops = await resolveTarget(input.config.explorer.targets.ops);

    explorer = {
      enabled: true,
      cursorKey,
      policyApproval,
      targets: {
        edutrack_production: edutrack,
        ops
      }
    };
  }
  return {
    hmacSecret,
    read,
    mutation,
    explorer
  };
}

export async function startOpsSqlWorker(
  input: {
    environment?: NodeJS.ProcessEnv;
    resolveSecret?: (reference: string) => Promise<string | null>;
    createReadPool?: (databaseUrl: string) => ProductionReadPool;
    createMutationPool?: (databaseUrl: string) => ProductionMutationPool;
    createExplorerPool?: (targetId: DatabaseTargetId, databaseUrl: string) => ProductionReadPool;
    now?: () => number;
    probeExplorerTarget?: (targetId: DatabaseTargetId) => Promise<void>;
    telemetry?: RuntimeTelemetry;
  } = {}
): Promise<{ close: () => Promise<void> }> {
  const config = readSqlWorkerRuntimeConfig(input.environment ?? process.env);
  const telemetryHmac =
    !input.telemetry && config.telemetry.enabled
      ? (await readFile(config.telemetryHmacPath ?? '', 'utf8')).trim()
      : undefined;
  if (!input.telemetry && config.telemetry.enabled && !telemetryHmac) {
    throw new Error('SQL worker telemetry credential is unavailable');
  }
  const telemetry =
    input.telemetry ??
    (config.telemetry.enabled
      ? createSqlWorkerRuntimeTelemetry({
          config: config.telemetry,
          hmacSecret: telemetryHmac!
        })
      : createRuntimeTelemetry({
          enabled: false,
          release: '0000000000000000000000000000000000000000',
          service: 'edutrack-ops-sql-worker',
          transport: async () => undefined
        }));
  const stopTelemetryMaintenance = startRuntimeTelemetryMaintenance({ flush: telemetry.flush });
  const disposeRuntimeTelemetry = installOpsRuntimeTelemetry(telemetry);
  const disposeNodeTelemetryLifecycle = installNodeTelemetryLifecycle({
    captureException: captureOpsException,
    flush: telemetry.flush,
    exit: (code) => process.exit(code)
  });
  let telemetryStopped = false;
  const stopRuntimeTelemetry = async (): Promise<void> => {
    if (telemetryStopped) return;
    telemetryStopped = true;
    stopTelemetryMaintenance();
    try {
      await flushRuntimeTelemetryFailOpen(telemetry);
    } finally {
      disposeNodeTelemetryLifecycle();
      disposeRuntimeTelemetry();
    }
  };
  const resolver =
    input.resolveSecret ??
    ((reference: string) => new FileSecretResolver(config.secretDirectory).resolve(reference));
  let credentials: SqlWorkerCredentials;
  try {
    credentials = await resolveSqlWorkerCredentials({ config, resolveSecret: resolver });
  } catch (error) {
    captureOpsException(error, {
      code: 'SQL_WORKER_CREDENTIALS_UNAVAILABLE',
      source: 'process',
      level: 'fatal'
    });
    await Promise.resolve();
    await stopRuntimeTelemetry();
    throw error;
  }
  const nonceStore = createExpiringNonceStore();
  let readPool: ProductionReadPool | undefined;
  let mutationPool: ProductionMutationPool | undefined;
  const explorerPools: ProductionReadPool[] = [];
  const registryOptions = {
    ...(input.now ? { now: input.now } : {}),
    ...(input.probeExplorerTarget
      ? { probe: (target: { id: DatabaseTargetId }) => input.probeExplorerTarget!(target.id) }
      : {})
  };
  try {
    const workerInput: Parameters<typeof createSqlWorkerCommandHandler>[0] = {
      read: { enabled: false },
      mutation: { enabled: false }
    };
    if (credentials.read.enabled) {
      const readCredentials = credentials.read;
      assertTlsProtectedPostgresUrl(readCredentials.databaseUrl);
      readPool = (input.createReadPool ?? createProductionReadPool)(readCredentials.databaseUrl);
      await assertProductionReadIdentity({
        database: readPool,
        expectedRole: readCredentials.role,
        expectedDatabase: readCredentials.databaseName
      });
      workerInput.read = {
        enabled: true,
        preview: createReadPreviewer({ pool: readPool }),
        schema: createProductionSchemaReader({
          pool: readPool,
          identity: { role: readCredentials.role, database: readCredentials.databaseName }
        })
      };
    }
    if (credentials.mutation.enabled) {
      const mutationCredentials = credentials.mutation;
      assertTlsProtectedPostgresUrl(mutationCredentials.databaseUrl);
      mutationPool = (input.createMutationPool ?? createProductionMutationPool)(
        mutationCredentials.databaseUrl
      );
      await assertProductionMutationIdentity({
        database: mutationPool,
        expectedRole: mutationCredentials.role,
        expectedDatabase: mutationCredentials.databaseName
      });
      workerInput.mutation = {
        enabled: true,
        preview: createMutationPreviewer({ pool: mutationPool })
      };
    }
    if (credentials.explorer.enabled) {
      const explorerCredentials = credentials.explorer;
      const targetEntries: TargetEntry[] = [];
      const setupTarget = async (
        targetId: DatabaseTargetId,
        label: string,
        targetCreds: TargetCredentials
      ) => {
        if (!targetCreds.enabled) {
          targetEntries.push({ id: targetId, label, status: 'disabled' });
          return;
        }
        try {
          assertTlsProtectedPostgresUrl(targetCreds.databaseUrl);
          const pool = input.createExplorerPool
            ? input.createExplorerPool(targetId, targetCreds.databaseUrl)
            : createExplorerTargetPool(targetId, targetCreds.databaseUrl);
          explorerPools.push(pool);
          await assertProductionReadIdentity({
            database: pool,
            expectedRole: targetCreds.role,
            expectedDatabase: targetCreds.databaseName
          });
          targetEntries.push({
            id: targetId,
            label,
            status: 'available',
            pool,
            databaseName: targetCreds.databaseName,
            role: targetCreds.role
          });
        } catch (targetError) {
          captureOpsException(targetError, {
            code: 'UNHANDLED_OPS_EXCEPTION',
            source: 'process',
            status: 500
          });
          targetEntries.push({
            id: targetId,
            label,
            status: 'unavailable',
            code: 'DATABASE_TARGET_UNAVAILABLE',
            error: targetError
          });
        }
      };

      await setupTarget(
        'edutrack_production',
        'EduTrack Production',
        credentials.explorer.targets.edutrack_production
      );
      await setupTarget('ops', 'Ops Database', credentials.explorer.targets.ops);

      const registry = createTargetRegistry(targetEntries, registryOptions);
      const policyApproval = parsePolicyApproval(explorerCredentials.policyApproval);
      const schemaReaders = new Map<
        DatabaseTargetId,
        () => Promise<DatabaseExplorerSchemaSnapshot>
      >();
      for (const entry of registry.all()) {
        if (entry.status !== 'available') continue;
        schemaReaders.set(
          entry.id,
          createExplorerSchemaReader({
            target: entry,
            getPolicyApproval: () => policyApproval
          })
        );
      }
      const schemaReader = async (
        targetId: DatabaseTargetId
      ): Promise<DatabaseExplorerSchemaSnapshot> => {
        const target = registry.get(targetId);
        const reader = schemaReaders.get(target.id);
        if (!reader) {
          throw Object.assign(new Error('DATABASE_TARGET_UNAVAILABLE'), {
            code: 'DATABASE_TARGET_UNAVAILABLE'
          });
        }
        return reader();
      };
      workerInput.explorer = {
        enabled: true,
        targets: () => registry.summaries(),
        schema: schemaReader,
        rows: async (request) => {
          const target = registry.get(request.targetId);
          const snapshot = await schemaReader(target.id);
          return readDatabaseRows({
            target,
            snapshot,
            cursorKey: explorerCredentials.cursorKey,
            request
          });
        },
        relatedRows: async (request) => {
          const target = registry.get(request.targetId);
          const snapshot = await schemaReader(target.id);
          return readRelatedRows({
            target,
            snapshot,
            cursorKey: explorerCredentials.cursorKey,
            request
          });
        }
      };
    } else {
      const registry = createTargetRegistry(
        [
          { id: 'edutrack_production', label: 'EduTrack Production', status: 'disabled' },
          { id: 'ops', label: 'Ops Database', status: 'disabled' }
        ],
        registryOptions
      );
      workerInput.explorer = {
        enabled: false,
        targets: () => registry.summaries()
      };
    }
    const handle = createSqlWorkerCommandHandler(workerInput);
    const server = await startWorkerProtocolServer({
      path: config.socketPath,
      secret: credentials.hmacSecret,
      consumeNonce: async (nonce) => nonceStore.consume(nonce.replace(/^sql-worker:/, '')),
      handle
    });
    let closing: Promise<void> | undefined;
    return {
      close: () => {
        closing ??= (async () => {
          let closeError: unknown;
          let hasCloseError = false;
          const rememberCloseFailure = (error: unknown): void => {
            if (!hasCloseError) {
              closeError = error;
              hasCloseError = true;
            }
          };
          try {
            await server.close();
          } catch (error) {
            captureOpsException(error, {
              code: 'SQL_WORKER_SERVER_CLOSE_FAILED',
              source: 'process'
            });
            rememberCloseFailure(error);
          }
          try {
            await readPool?.end();
          } catch (error) {
            captureOpsException(error, {
              code: 'SQL_WORKER_READ_POOL_CLOSE_FAILED',
              source: 'database'
            });
            rememberCloseFailure(error);
          }
          try {
            await mutationPool?.end();
          } catch (error) {
            captureOpsException(error, {
              code: 'SQL_WORKER_MUTATION_POOL_CLOSE_FAILED',
              source: 'database'
            });
            rememberCloseFailure(error);
          }
          for (const pool of explorerPools) {
            try {
              await pool.end();
            } catch (error) {
              captureOpsException(error, {
                code: 'SQL_WORKER_EXPLORER_POOL_CLOSE_FAILED',
                source: 'database'
              });
              rememberCloseFailure(error);
            }
          }
          try {
            await stopRuntimeTelemetry();
          } catch (error) {
            captureOpsException(error, {
              code: 'UNHANDLED_OPS_EXCEPTION',
              source: 'process',
              status: 500
            });
            rememberCloseFailure(error);
          }
          if (hasCloseError) throw closeError;
        })();
        return closing;
      }
    };
  } catch (error) {
    captureOpsException(error, {
      code: 'SQL_WORKER_STARTUP_FAILED',
      source: 'process',
      level: 'fatal'
    });
    await Promise.resolve();
    try {
      await readPool?.end();
    } catch (cleanupError) {
      captureOpsException(cleanupError, {
        code: 'SQL_WORKER_READ_POOL_CLOSE_FAILED',
        source: 'database'
      });
    }
    try {
      await mutationPool?.end();
    } catch (cleanupError) {
      captureOpsException(cleanupError, {
        code: 'SQL_WORKER_MUTATION_POOL_CLOSE_FAILED',
        source: 'database'
      });
    }
    for (const pool of explorerPools) {
      try {
        await pool.end();
      } catch (cleanupError) {
        captureOpsException(cleanupError, {
          code: 'SQL_WORKER_EXPLORER_POOL_CLOSE_FAILED',
          source: 'database'
        });
      }
    }
    try {
      await stopRuntimeTelemetry();
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'process',
        status: 500
      });
    }
    throw error;
  }
}
