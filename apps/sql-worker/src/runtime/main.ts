import { FileSecretResolver } from '../../../../packages/security/src/fileSecretResolver.js';
import { Pool } from 'pg';

import {
  assertProductionReadIdentity,
  assertTlsProtectedPostgresUrl,
  createReadPreviewer
} from '../database/readPool.js';
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
};

type ProductionReadPool = {
  query: <T>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  connect: () => Promise<{
    query: <T>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
    release: () => void;
  }>;
  end: () => Promise<void>;
};

function createProductionReadPool(databaseUrl: string): ProductionReadPool {
  return new Pool({
    connectionString: databaseUrl,
    application_name: 'edutrack-ops-read',
    max: 2,
    idleTimeoutMillis: 30_000
  });
}

export async function resolveSqlWorkerCredentials(input: {
  config: SqlWorkerRuntimeConfig;
  resolveSecret: (reference: string) => Promise<string | null>;
}): Promise<SqlWorkerCredentials> {
  const hmacSecret = await input.resolveSecret(input.config.hmacSecretReference);
  if (!hmacSecret) throw new Error('SQL worker runtime credentials are unavailable');
  if (!input.config.read.enabled) return { hmacSecret, read: { enabled: false } };

  const databaseUrl = await input.resolveSecret(input.config.read.databaseUrlReference);
  if (!databaseUrl) throw new Error('SQL worker runtime credentials are unavailable');
  return {
    hmacSecret,
    read: {
      enabled: true,
      databaseUrl,
      databaseName: input.config.read.databaseName,
      role: input.config.read.role
    }
  };
}

export async function startOpsSqlWorker(
  input: {
    environment?: NodeJS.ProcessEnv;
    resolveSecret?: (reference: string) => Promise<string | null>;
    createReadPool?: (databaseUrl: string) => ProductionReadPool;
  } = {}
): Promise<{ close: () => Promise<void> }> {
  const config = readSqlWorkerRuntimeConfig(input.environment ?? process.env);
  const resolver =
    input.resolveSecret ??
    ((reference: string) => new FileSecretResolver(config.secretDirectory).resolve(reference));
  const credentials = await resolveSqlWorkerCredentials({ config, resolveSecret: resolver });
  const nonceStore = createExpiringNonceStore();
  let readPool: ProductionReadPool | undefined;
  try {
    let handle: ReturnType<typeof createSqlWorkerCommandHandler>;
    if (credentials.read.enabled) {
      const readCredentials = credentials.read;
      assertTlsProtectedPostgresUrl(readCredentials.databaseUrl);
      readPool = (input.createReadPool ?? createProductionReadPool)(readCredentials.databaseUrl);
      await assertProductionReadIdentity({
        database: readPool,
        expectedRole: readCredentials.role,
        expectedDatabase: readCredentials.databaseName
      });
      handle = createSqlWorkerCommandHandler({
        read: {
          enabled: true,
          preview: createReadPreviewer({ pool: readPool }),
          schema: createProductionSchemaReader({
            pool: readPool,
            identity: { role: readCredentials.role, database: readCredentials.databaseName }
          })
        }
      });
    } else {
      handle = createSqlWorkerCommandHandler({ read: { enabled: false } });
    }
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
      }
    };
  } catch (error) {
    await readPool?.end().catch(() => undefined);
    throw error;
  }
}
