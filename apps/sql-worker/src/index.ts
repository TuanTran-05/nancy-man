import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startOpsSqlWorker } from './runtime/main.js';

export { resolveSqlWorkerCredentials, startOpsSqlWorker } from './runtime/main.js';

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void startOpsSqlWorker().catch(() => {
    process.stderr.write('Ops SQL worker failed to start\n');
    process.exitCode = 1;
  });
}
