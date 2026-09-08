import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getOpsPool } from '../../../../packages/db/src/client.js';

import { FileSecretResolver } from '../../../api/src/runtime/fileSecretResolver.js';
import { createPoolDatabase } from '../../../api/src/runtime/poolDatabase.js';
import { readOpsRuntimeConfig } from '../../../api/src/runtime/runtimeConfig.js';
import {
  createRuntimeTelemetry,
  startRuntimeTelemetryMaintenance
} from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
import { installNodeTelemetryLifecycle } from '../../../../packages/telemetry-sdk/src/nodeLifecycle.js';
import { PostgresAlertOutbox } from '../outbox/postgresAlertOutbox.js';
import { PostgresAlertScheduler } from '../outbox/postgresAlertScheduler.js';
import {
  captureOpsException,
  createNotifierRuntimeTelemetry,
  flushRuntimeTelemetryFailOpen,
  installOpsRuntimeTelemetry
} from '../telemetry/runtimeTelemetry.js';

import { readNotifierPollInterval } from './notifierConfig.js';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function startOpsNotifier(
  environment: NodeJS.ProcessEnv = process.env
): Promise<{ close: () => Promise<void>; finished: Promise<void> }> {
  const config = readOpsRuntimeConfig(environment);
  const pollIntervalMs = readNotifierPollInterval(environment);
  const resolver = new FileSecretResolver(config.secretDirectory);
  const telemetryHmacSecret = config.telemetry.enabled
    ? await resolver.resolve(config.telemetry.hmacSecretReference)
    : undefined;
  if (config.telemetry.enabled && !telemetryHmacSecret) {
    throw new Error('Ops notifier telemetry credential is unavailable');
  }
  const telemetry = config.telemetry.enabled
    ? createNotifierRuntimeTelemetry({
        config: config.telemetry,
        hmacSecret: telemetryHmacSecret!
      })
    : createRuntimeTelemetry({
        enabled: false,
        release: '0000000000000000000000000000000000000000',
        service: 'edutrack-ops-notifier',
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
  let pool: ReturnType<typeof getOpsPool> | undefined;
  let startupCode = 'NOTIFIER_CREDENTIALS_UNAVAILABLE';
  let startupSource: 'process' | 'database' = 'process';
  try {
    const databaseUrl = await resolver.resolve(config.databaseUrlReference);
    if (!databaseUrl) throw new Error('Ops notifier credential is unavailable');
    startupCode = 'NOTIFIER_DATABASE_UNAVAILABLE';
    startupSource = 'database';
    pool = getOpsPool(databaseUrl);
    const runtimePool = pool;
    const database = createPoolDatabase(runtimePool);
    await database.query('SELECT 1');
    const scheduler = new PostgresAlertScheduler({
      database,
      outbox: new PostgresAlertOutbox(database)
    });
    let stopping = false;
    const finished = (async () => {
      while (!stopping) {
        await scheduler.schedule(new Date());
        if (!stopping) await wait(pollIntervalMs);
      }
    })();
    let closing: Promise<void> | undefined;
    return {
      finished,
      close: () => {
        closing ??= (async () => {
          stopping = true;
          let closeError: unknown;
          try {
            await finished;
          } catch (error) {
            captureOpsException(error, {
              code: 'NOTIFIER_DAEMON_FAILED',
              source: 'job',
              level: 'fatal'
            });
            closeError = error;
          }
          try {
            await runtimePool.end();
          } catch (error) {
            captureOpsException(error, {
              code: 'NOTIFIER_DATABASE_CLOSE_FAILED',
              source: 'database'
            });
            closeError ??= error;
          } finally {
            await stopRuntimeTelemetry();
          }
          if (closeError) throw closeError;
        })();
        return closing;
      }
    };
  } catch (error) {
    captureOpsException(error, { code: startupCode, source: startupSource, level: 'fatal' });
    try {
      await pool?.end();
    } catch (cleanupError) {
      captureOpsException(cleanupError, {
        code: 'NOTIFIER_DATABASE_CLOSE_FAILED',
        source: 'database'
      });
    } finally {
      await stopRuntimeTelemetry();
    }
    throw error;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void startOpsNotifier()
    .then(async (notifier) => {
      try {
        await notifier.finished;
      } finally {
        await notifier.close();
      }
    })
    .catch((error) => {
      // The startup/daemon owner captures before its runtime binding is disposed.
      captureOpsException(error, {
        code: 'UNHANDLED_PROMISE_REJECTION',
        source: 'process',
        status: 500,
      });
      process.exitCode = 1;
    });
}
