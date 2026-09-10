import { readFile } from 'node:fs/promises';

import {
  createOpsProcessRuntimeTelemetryFromEnvironment,
  runConfiguredOpsTelemetryOneShot
} from '../../../../../packages/telemetry-sdk/src/oneShot.js';
import type { RuntimeTelemetry } from '../../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
import { loadFailsafeConfig } from '../config.js';
import { runFailsafe } from './failsafe.js';

export function runFailsafeEntrypoint(
  input: {
    environment?: NodeJS.ProcessEnv;
    telemetry?: RuntimeTelemetry;
    run?: () => Promise<void>;
    onFailure?: (error: unknown) => void | Promise<void>;
    rethrow?: boolean;
  } = {}
): Promise<void | undefined> {
  const environment = input.environment ?? process.env;
  const common = {
    createTelemetry: () =>
      input.telemetry ??
      createOpsProcessRuntimeTelemetryFromEnvironment({
        environment,
        resolveHmacSecret: async () => {
          const hmacFile = environment.OPS_TELEMETRY_HMAC_FILE?.trim();
          if (!hmacFile) throw new Error('OPS_TELEMETRY_HMAC_FILE is required');
          return readFile(hmacFile, 'utf8');
        },
        service: 'edutrack-ops-failsafe',
        spoolName: 'failsafe'
      }),
    failureContext: {
      code: 'OPS_FAILSAFE_FAILED',
      source: 'provider' as const,
      level: 'fatal' as const
    },
    run: input.run ?? (() => runFailsafe(loadFailsafeConfig(environment))),
    ...(input.onFailure ? { onFailure: input.onFailure } : {})
  };
  return input.rethrow === false
    ? runConfiguredOpsTelemetryOneShot({ ...common, rethrow: false })
    : runConfiguredOpsTelemetryOneShot({ ...common, rethrow: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runFailsafeEntrypoint({
    rethrow: false,
    onFailure: () => {
      process.exitCode = 1;
    }
  });
}
