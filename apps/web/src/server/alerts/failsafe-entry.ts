import { runFailsafeEntrypoint } from './failsafe-main.js';

void runFailsafeEntrypoint({
  rethrow: false,
  onFailure: (error: unknown) => {
    console.error('ops-failsafe failed', error instanceof Error ? error.message : 'unknown_error');
    process.exitCode = 1;
  }
});
