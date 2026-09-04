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
import { createNotifierRuntimeTelemetry } from '../telemetry/runtimeTelemetry.js';

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
  const databaseUrl = await resolver.resolve(config.databaseUrlReference);
  if (!databaseUrl) throw new Error('Ops notifier credential is unavailable');
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
  installNodeTelemetryLifecycle({
    captureException: telemetry.captureException,
    flush: telemetry.flush
  });

  const pool = getOpsPool(databaseUrl);
  const database = createPoolDatabase(pool);
  try {
    await database.query('SELECT 1');
  } catch (error) {
    telemetry.captureException(error, {
      code: 'NOTIFIER_DATABASE_UNAVAILABLE',
      source: 'database',
      level: 'fatal'
    });
    await Promise.resolve();
    await telemetry.flush().catch(() => undefined);
    stopTelemetryMaintenance();
    await pool.end();
    throw error;
  }

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
        await finished;
        stopTelemetryMaintenance();
        await telemetry.flush().catch(() => undefined);
        await pool.end();
      })();
      return closing;
    }
  };
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void startOpsNotifier().then((notifier) => notifier.finished);
}
