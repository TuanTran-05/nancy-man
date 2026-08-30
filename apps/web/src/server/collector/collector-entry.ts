import { startCollector } from './collector-main.js';

startCollector().catch((error: unknown) => {
  console.error(
    'ops-collector startup failed',
    error instanceof Error ? error.message : 'unknown_error'
  );
  process.exitCode = 1;
});
