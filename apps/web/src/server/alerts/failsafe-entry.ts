import { loadFailsafeConfig } from '../config.js';
import { runFailsafe } from './failsafe.js';

runFailsafe(loadFailsafeConfig(process.env)).catch((error: unknown) => {
  console.error('ops-failsafe failed', error instanceof Error ? error.message : 'unknown_error');
  process.exitCode = 1;
});
