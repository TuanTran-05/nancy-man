import { type Server } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getOpsPool } from '../../../../packages/db/src/client.js';

import { createOpsApiRuntime } from './createOpsApiRuntime.js';
import { FileSecretResolver } from './fileSecretResolver.js';
import { createPoolDatabase } from './poolDatabase.js';
import { readOpsRuntimeConfig, type OpsRuntimeConfig } from './runtimeConfig.js';

type RuntimeCredentials = {
  databaseUrl: string;
  sessionPepper: string;
  rateLimitPepper: string;
  browserContextKey: string;
  authSessionPepper: string;
  passwordFingerprintPepper: string;
  mfaEncryptionKey: Buffer;
  sqlWorker?: { socketPath: string; hmacSecret: string; auditEncryptionKey: Buffer };
};

export async function resolveRuntimeCredentials(input: {
  config: OpsRuntimeConfig;
  resolveSecret: (reference: string) => Promise<string | null>;
}): Promise<RuntimeCredentials> {
  const [
    databaseUrl,
    sessionPepper,
    rateLimitPepper,
    browserContextKey,
    authSessionPepper,
    mfaKey,
    passwordFingerprintPepper
  ] = await Promise.all([
    input.resolveSecret(input.config.databaseUrlReference),
    input.resolveSecret(input.config.sessionPepperReference),
    input.resolveSecret(input.config.rateLimitPepperReference),
    input.resolveSecret(input.config.browserContextKey.secretReference),
    input.resolveSecret(input.config.authSessionPepperReference),
    input.resolveSecret(input.config.mfaEncryptionKeyReference),
    input.resolveSecret(input.config.passwordFingerprintPepperReference)
  ]);
  if (
    !databaseUrl ||
    !sessionPepper ||
    !rateLimitPepper ||
    !browserContextKey ||
    !authSessionPepper ||
    !mfaKey ||
    !passwordFingerprintPepper
  ) {
    throw new Error('Ops API runtime credentials are unavailable');
  }
  const mfaEncryptionKey = Buffer.from(mfaKey, 'base64url');
  if (mfaEncryptionKey.length !== 32)
    throw new Error('Ops API runtime credentials are unavailable');
  if (!input.config.sqlWorker.enabled) {
    return {
      databaseUrl,
      sessionPepper,
      rateLimitPepper,
      browserContextKey,
      authSessionPepper,
      passwordFingerprintPepper,
      mfaEncryptionKey
    };
  }
  const [sqlWorkerHmac, sqlAuditKey] = await Promise.all([
    input.resolveSecret(input.config.sqlWorker.hmacSecretReference),
    input.resolveSecret(input.config.sqlWorker.auditEncryptionKeyReference)
  ]);
  const auditEncryptionKey = sqlAuditKey ? Buffer.from(sqlAuditKey, 'base64url') : null;
  if (!sqlWorkerHmac || !auditEncryptionKey || auditEncryptionKey.length !== 32) {
    throw new Error('Ops API runtime credentials are unavailable');
  }
  return {
    databaseUrl,
    sessionPepper,
    rateLimitPepper,
    browserContextKey,
    authSessionPepper,
    passwordFingerprintPepper,
    mfaEncryptionKey,
    sqlWorker: {
      socketPath: input.config.sqlWorker.socketPath,
      hmacSecret: sqlWorkerHmac,
      auditEncryptionKey
    }
  };
}

function listen(app: ReturnType<typeof createOpsApiRuntime>['app'], host: string, port: number) {
  return new Promise<Server>((resolveServer, reject) => {
    const server = app.listen(port, host);
    server.once('error', reject);
    server.once('listening', () => {
      server.off('error', reject);
      resolveServer(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose()))
  );
}

export async function startOpsApi(environment: NodeJS.ProcessEnv = process.env): Promise<{
  close: () => Promise<void>;
}> {
  const config = readOpsRuntimeConfig(environment);
  const resolver = new FileSecretResolver(config.secretDirectory);
  const credentials = await resolveRuntimeCredentials({
    config,
    resolveSecret: (ref) => resolver.resolve(ref)
  });
  const pool = getOpsPool(credentials.databaseUrl);
  const database = createPoolDatabase(pool);

  try {
    await database.query('SELECT 1');
    const runtime = createOpsApiRuntime({
      config,
      database,
      sessionPepper: credentials.sessionPepper,
      rateLimitPepper: credentials.rateLimitPepper,
      browserContextKey: credentials.browserContextKey,
      authSessionPepper: credentials.authSessionPepper,
      passwordFingerprintPepper: credentials.passwordFingerprintPepper,
      mfaEncryptionKey: credentials.mfaEncryptionKey,
      ...(credentials.sqlWorker ? { sqlWorker: credentials.sqlWorker } : {}),
      resolveSecret: (ref) => resolver.resolve(ref)
    });
    const server = await listen(runtime.app, config.apiHost, config.apiPort);
    let closing: Promise<void> | undefined;
    return {
      close: () => {
        closing ??= closeServer(server).finally(() => pool.end());
        return closing;
      }
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void startOpsApi().catch(() => {
    process.stderr.write('Ops API failed to start\n');
    process.exitCode = 1;
  });
}
