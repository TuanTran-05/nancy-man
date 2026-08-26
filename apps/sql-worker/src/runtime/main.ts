import { FileSecretResolver } from '../../../../packages/security/src/fileSecretResolver.js';
import { Pool } from 'pg';

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
import { startWorkerProtocolServer } from '../protocol/server.js';
import { createSqlWorkerCommandHandler } from './commandHandler.js';
import { createExpiringNonceStore } from './nonceStore.js';
import type { SqlWorkerRuntimeConfig } from './runtimeConfig.js';
import { readSqlWorkerRuntimeConfig } from './runtimeConfig.js';

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
  return {
    hmacSecret,
    read,
    mutation
  };
}

export async function startOpsSqlWorker(
  input: {
    environment?: NodeJS.ProcessEnv;
    resolveSecret?: (reference: string) => Promise<string | null>;
    createReadPool?: (databaseUrl: string) => ProductionReadPool;
    createMutationPool?: (databaseUrl: string) => ProductionMutationPool;
  } = {}
): Promise<{ close: () => Promise<void> }> {
  const config = readSqlWorkerRuntimeConfig(input.environment ?? process.env);
  const resolver =
    input.resolveSecret ??
    ((reference: string) => new FileSecretResolver(config.secretDirectory).resolve(reference));
  const credentials = await resolveSqlWorkerCredentials({ config, resolveSecret: resolver });
  const nonceStore = createExpiringNonceStore();
  let readPool: ProductionReadPool | undefined;
  let mutationPool: ProductionMutationPool | undefined;
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
    const handle = createSqlWorkerCommandHandler(workerInput);
    const server = await startWorkerProtocolServer({
      path: config.socketPath,
      secret: credentials.hmacSecret,
      consumeNonce: async (nonce) => nonceStore.consume(nonce.replace(/^sql-worker:/, '')),
      handle
    });
    return {
      close: async () => {
        await server.close();
        await readPool?.end();
        await mutationPool?.end();
      }
    };
  } catch (error) {
    await readPool?.end().catch(() => undefined);
    await mutationPool?.end().catch(() => undefined);
    throw error;
  }
}
