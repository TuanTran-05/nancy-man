import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getOpsPool } from '../../../../packages/db/src/client.js';

import { FileSecretResolver } from '../../../api/src/runtime/fileSecretResolver.js';
import { createPoolDatabase } from '../../../api/src/runtime/poolDatabase.js';
import { readOpsRuntimeConfig } from '../../../api/src/runtime/runtimeConfig.js';
import { PostgresAlertOutbox } from '../outbox/postgresAlertOutbox.js';
import { PostgresAlertScheduler } from '../outbox/postgresAlertScheduler.js';

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

  const pool = getOpsPool(databaseUrl);
  const database = createPoolDatabase(pool);
  try {
    await database.query('SELECT 1');
  } catch (error) {
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
        await pool.end();
      })();
      return closing;
    }
  };
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void startOpsNotifier()
    .then((notifier) => notifier.finished)
    .catch(() => {
      process.stderr.write('Ops notifier failed to start or schedule alerts\n');
      process.exitCode = 1;
    });
}
