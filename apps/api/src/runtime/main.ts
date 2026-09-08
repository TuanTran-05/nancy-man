import { type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseCatalog } from '../../../../packages/config-contracts/src/catalog.js';
import { getOpsPool } from '../../../../packages/db/src/client.js';

import { ConfigAgentClient } from '../infrastructure/configAgentClient.js';
import { createOpsApiRuntime } from './createOpsApiRuntime.js';
import { FileSecretResolver } from './fileSecretResolver.js';
import { createPoolDatabase } from './poolDatabase.js';
import { readOpsRuntimeConfig, type OpsRuntimeConfig } from './runtimeConfig.js';
import {
  captureOpsException,
  createConfiguredRuntimeTelemetry,
  createRuntimeTelemetry,
  flushRuntimeTelemetryFailOpen,
  installOpsRuntimeTelemetry,
  startRuntimeTelemetryMaintenance
} from '../telemetry/runtimeTelemetry.js';
import { installNodeTelemetryLifecycle } from '../../../../packages/telemetry-sdk/src/nodeLifecycle.js';

type RuntimeCredentials = {
  databaseUrl: string;
  sessionPepper: string;
  rateLimitPepper: string;
  browserContextKey: string;
  authSessionPepper: string;
  passwordFingerprintPepper: string;
  legacyMonitoringHmacSecret: string;
  telemetryHmacSecret?: string;
  mfaEncryptionKey: Buffer;
  sqlWorker?: { socketPath: string; hmacSecret: string; auditEncryptionKey: Buffer };
  configAgent?: {
    socketPath: string;
    protocolHmacKey: string;
    protocolHmacKeyId: string;
    expectedManifestVersion: string;
    expectedCatalogVersion: string;
    expectedCatalogDigest: string;
    connectTimeoutMs: number;
    readTimeoutMs: number;
    totalTimeoutMs: number;
    maximumResponseBytes: number;
  };
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
    passwordFingerprintPepper,
    legacyMonitoringHmacSecret
  ] = await Promise.all([
    input.resolveSecret(input.config.databaseUrlReference),
    input.resolveSecret(input.config.sessionPepperReference),
    input.resolveSecret(input.config.rateLimitPepperReference),
    input.resolveSecret(input.config.browserContextKey.secretReference),
    input.resolveSecret(input.config.authSessionPepperReference),
    input.resolveSecret(input.config.mfaEncryptionKeyReference),
    input.resolveSecret(input.config.passwordFingerprintPepperReference),
    input.resolveSecret(input.config.legacyMonitoringHmacReference)
  ]);
  if (
    !databaseUrl ||
    !sessionPepper ||
    !rateLimitPepper ||
    !browserContextKey ||
    !authSessionPepper ||
    !mfaKey ||
    !passwordFingerprintPepper ||
    !legacyMonitoringHmacSecret
  ) {
    throw new Error('Ops API runtime credentials are unavailable');
  }
  const telemetryHmacSecret = input.config.telemetry.enabled
    ? await input.resolveSecret(input.config.telemetry.hmacSecretReference)
    : undefined;
  if (input.config.telemetry.enabled && !telemetryHmacSecret) {
    throw new Error('Ops API runtime credentials are unavailable');
  }
  const mfaEncryptionKey = Buffer.from(mfaKey, 'base64url');
  if (mfaEncryptionKey.length !== 32)
    throw new Error('Ops API runtime credentials are unavailable');
  const configuredAgent = input.config.configAgent;
  const configAgent = configuredAgent.enabled
    ? await (async () => {
        const protocolHmacKey = await input.resolveSecret(configuredAgent.protocolHmacKeyReference);
        if (!protocolHmacKey) throw new Error('Ops API runtime credentials are unavailable');
        return {
          socketPath: configuredAgent.socketPath,
          protocolHmacKey,
          protocolHmacKeyId: configuredAgent.protocolHmacKeyId,
          expectedManifestVersion: configuredAgent.expectedManifestVersion,
          expectedCatalogVersion: configuredAgent.expectedCatalogVersion,
          expectedCatalogDigest: configuredAgent.expectedCatalogDigest,
          connectTimeoutMs: configuredAgent.connectTimeoutMs,
          readTimeoutMs: configuredAgent.readTimeoutMs,
          totalTimeoutMs: configuredAgent.totalTimeoutMs,
          maximumResponseBytes: configuredAgent.maximumResponseBytes
        };
      })()
    : undefined;
  if (!input.config.sqlWorker.enabled) {
    return {
      databaseUrl,
      sessionPepper,
      rateLimitPepper,
      browserContextKey,
      authSessionPepper,
      passwordFingerprintPepper,
      legacyMonitoringHmacSecret,
      mfaEncryptionKey,
      ...(telemetryHmacSecret ? { telemetryHmacSecret } : {}),
      ...(configAgent ? { configAgent } : {})
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
    legacyMonitoringHmacSecret,
    mfaEncryptionKey,
    ...(telemetryHmacSecret ? { telemetryHmacSecret } : {}),
    sqlWorker: {
      socketPath: input.config.sqlWorker.socketPath,
      hmacSecret: sqlWorkerHmac,
      auditEncryptionKey
    },
    ...(configAgent ? { configAgent } : {})
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

export async function closeOpsApiResources(input: {
  hasPrimaryFailure?: boolean;
  primaryFailure?: unknown;
  closeServer?: () => Promise<void>;
  closePool?: () => Promise<void>;
  stopTelemetry: () => Promise<void>;
}): Promise<void> {
  let hasFailure = input.hasPrimaryFailure === true;
  let firstFailure = input.primaryFailure;
  if (input.closeServer) {
    try {
      await input.closeServer();
    } catch (error) {
      captureOpsException(error, { code: 'API_SERVER_CLOSE_FAILED', source: 'process' });
      if (!hasFailure) {
        firstFailure = error;
        hasFailure = true;
      }
    }
  }
  if (input.closePool) {
    try {
      await input.closePool();
    } catch (error) {
      captureOpsException(error, { code: 'API_DATABASE_CLOSE_FAILED', source: 'database' });
      if (!hasFailure) {
        firstFailure = error;
        hasFailure = true;
      }
    }
  }
  await input.stopTelemetry();
  if (hasFailure) throw firstFailure;
}

export async function startOpsApi(
  environment: NodeJS.ProcessEnv = process.env,
  overrides: { legacyMonitoringBaseUrl?: string; monitoringAllowedOrigin?: string } = {}
): Promise<{
  app: ReturnType<typeof createOpsApiRuntime>['app'];
  close: () => Promise<void>;
}> {
  const config = readOpsRuntimeConfig(environment);
  const resolver = new FileSecretResolver(config.secretDirectory);
  const telemetryHmacSecret = config.telemetry.enabled
    ? await resolver.resolve(config.telemetry.hmacSecretReference)
    : undefined;
  if (config.telemetry.enabled && !telemetryHmacSecret) {
    throw new Error('Ops API telemetry credential is unavailable');
  }
  const telemetry = config.telemetry.enabled
    ? createConfiguredRuntimeTelemetry({
        config: config.telemetry,
        hmacSecret: telemetryHmacSecret!,
        service: 'edutrack-ops-api',
        spoolDirectory: join(config.telemetry.spoolDirectory, 'api')
      })
    : createRuntimeTelemetry({
        enabled: false,
        release: '0000000000000000000000000000000000000000',
        service: 'edutrack-ops-api',
        transport: async () => undefined
      });
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
  let credentials: RuntimeCredentials;
  try {
    credentials = await resolveRuntimeCredentials({
      config,
      resolveSecret: (ref) => resolver.resolve(ref)
    });
  } catch (error) {
    captureOpsException(error, {
      code: 'API_CREDENTIALS_UNAVAILABLE',
      source: 'process',
      level: 'fatal'
    });
    await stopRuntimeTelemetry();
    throw error;
  }
  let configAgent: ConfigAgentClient | undefined;
  let catalog: ReturnType<typeof parseCatalog> | undefined;
  try {
    configAgent = credentials.configAgent
      ? new ConfigAgentClient({
          socketPath: credentials.configAgent.socketPath,
          hmacKey: credentials.configAgent.protocolHmacKey,
          hmacKeyId: credentials.configAgent.protocolHmacKeyId,
          connectTimeoutMs: credentials.configAgent.connectTimeoutMs,
          readTimeoutMs: credentials.configAgent.readTimeoutMs,
          totalTimeoutMs: credentials.configAgent.totalTimeoutMs,
          maximumResponseBytes: credentials.configAgent.maximumResponseBytes
        })
      : undefined;
    catalog = configAgent
      ? parseCatalog(
          await readFile(
            environment.OPS_VARIABLES_CATALOG_PATH ??
              resolve(process.cwd(), 'config/variables/catalog.yaml'),
            'utf8'
          )
        )
      : undefined;
    if (configAgent && catalog) {
      const enabledAgentConfig = config.configAgent.enabled ? config.configAgent : null;
      const requiredOperations = [
        ...(enabledAgentConfig?.draftEnabled
          ? (['change.validate', 'change.save', 'change.cancel', 'change.status'] as const)
          : []),
        ...(enabledAgentConfig &&
        (enabledAgentConfig.runtimeApplyEnabled || enabledAgentConfig.buildApplyEnabled)
          ? (['change.apply'] as const)
          : []),
        ...(enabledAgentConfig &&
        (enabledAgentConfig.draftEnabled ||
          enabledAgentConfig.runtimeApplyEnabled ||
          enabledAgentConfig.buildApplyEnabled)
          ? (['application.clearApplyBlock'] as const)
          : [])
      ];
      const requiredStrategies = [
        ...(enabledAgentConfig?.runtimeApplyEnabled
          ? (['no_runtime_action', 'next_job', 'runtime_restart', 'credential_restart'] as const)
          : []),
        ...(enabledAgentConfig?.buildApplyEnabled ? (['build_redeploy'] as const) : [])
      ];
      await configAgent.negotiate({
        manifestVersion: credentials.configAgent!.expectedManifestVersion,
        catalogVersion: credentials.configAgent!.expectedCatalogVersion,
        catalogDigest: credentials.configAgent!.expectedCatalogDigest,
        requiredOperations,
        requiredStrategies
      });
    }
  } catch (error) {
    captureOpsException(error, {
      code: 'CONFIG_AGENT_NEGOTIATION_FAILED',
      source: 'api',
      level: 'fatal'
    });
    await Promise.resolve();
    await stopRuntimeTelemetry();
    throw error;
  }
  let pool: ReturnType<typeof getOpsPool> | undefined;
  try {
    pool = getOpsPool(credentials.databaseUrl);
    const runtimePool = pool;
    const database = createPoolDatabase(runtimePool);
    await database.query('SELECT 1');
    const runtime = createOpsApiRuntime({
      config,
      database,
      sessionPepper: credentials.sessionPepper,
      rateLimitPepper: credentials.rateLimitPepper,
      browserContextKey: credentials.browserContextKey,
      authSessionPepper: credentials.authSessionPepper,
      passwordFingerprintPepper: credentials.passwordFingerprintPepper,
      legacyMonitoringHmacSecret: credentials.legacyMonitoringHmacSecret,
      ...(overrides.legacyMonitoringBaseUrl
        ? { legacyMonitoringBaseUrl: overrides.legacyMonitoringBaseUrl }
        : {}),
      ...(overrides.monitoringAllowedOrigin
        ? { monitoringAllowedOrigin: overrides.monitoringAllowedOrigin }
        : {}),
      mfaEncryptionKey: credentials.mfaEncryptionKey,
      ...(credentials.sqlWorker ? { sqlWorker: credentials.sqlWorker } : {}),
      ...(configAgent && catalog ? { configAgent: { client: configAgent, catalog } } : {}),
      telemetry,
      resolveSecret: (ref) => resolver.resolve(ref)
    });
    const server = await listen(runtime.app, config.apiHost, config.apiPort);
    let closing: Promise<void> | undefined;
    return {
      app: runtime.app,
      close: () => {
        closing ??= closeOpsApiResources({
          closeServer: () => closeServer(server),
          closePool: () => runtimePool.end(),
          stopTelemetry: stopRuntimeTelemetry
        });
        return closing;
      }
    };
  } catch (error) {
    captureOpsException(error, {
      code: 'API_STARTUP_FAILED',
      source: 'api',
      level: 'fatal'
    });
    const startupPool = pool;
    await closeOpsApiResources({
      hasPrimaryFailure: true,
      primaryFailure: error,
      ...(startupPool ? { closePool: () => startupPool.end() } : {}),
      stopTelemetry: stopRuntimeTelemetry
    });
    throw error;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void startOpsApi().catch((error) => {
    captureOpsException(error, {
      code: 'UNHANDLED_PROMISE_REJECTION',
      source: 'process',
      status: 500,
    });
    process.stderr.write('Ops API failed to start\n');
    process.exitCode = 1;
  });
}
