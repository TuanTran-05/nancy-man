import { hostname } from 'node:os';
import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getOpsPool } from '../../../../packages/db/src/client.js';

import { FileSecretResolver } from '../../../api/src/runtime/fileSecretResolver.js';
import { createPoolDatabase } from '../../../api/src/runtime/poolDatabase.js';
import { readOpsRuntimeConfig } from '../../../api/src/runtime/runtimeConfig.js';
import { runProcessorOnce } from '../index.js';
import { PostgresIssueRepository } from '../issues/postgresIssueRepository.js';
import { PostgresProcessorQueue } from '../queue/postgresProcessorQueue.js';

import { readProcessorPollInterval } from './processorConfig.js';
import { runProcessorDaemon } from './runProcessorDaemon.js';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function startOpsProcessor(
  environment: NodeJS.ProcessEnv = process.env
): Promise<{ close: () => Promise<void>; finished: Promise<void> }> {
  const config = readOpsRuntimeConfig(environment);
  const pollIntervalMs = readProcessorPollInterval(environment);
  const resolver = new FileSecretResolver(config.secretDirectory);
  const databaseUrl = await resolver.resolve(config.databaseUrlReference);
  if (!databaseUrl) throw new Error('Ops processor credential is unavailable');

  const pool = getOpsPool(databaseUrl);
  const database = createPoolDatabase(pool);
  try {
    await database.query('SELECT 1');
  } catch (error) {
    await pool.end();
    throw error;
  }

  const queue = new PostgresProcessorQueue(database);
  const repository = new PostgresIssueRepository(database);
  const workerId = `ops-processor:${hostname()}:${process.pid}`;
  let stopping = false;
  const finished = runProcessorDaemon({
    pollIntervalMs,
    releaseExpiredClaims: (now) => queue.releaseExpiredClaims(now),
    runOnce: () => runProcessorOnce({ workerId, queue, repository }),
    wait,
    shouldStop: () => stopping
  });
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
  void startOpsProcessor()
    .then((processor) => processor.finished)
    .catch(() => {
      process.stderr.write('Ops processor failed to start or process an event\n');
      process.exitCode = 1;
    });
}
