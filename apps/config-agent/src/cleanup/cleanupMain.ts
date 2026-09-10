import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  createOpsProcessRuntimeTelemetryFromEnvironment,
  runConfiguredOpsTelemetryOneShot
} from '../../../../packages/telemetry-sdk/src/oneShot.js';
import type { RuntimeTelemetry } from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';

import { RetentionService } from './retentionService.js';
import { readConfigAgentRuntimeConfig } from '../runtimeConfig.js';

export async function runConfigAgentCleanup(environment: NodeJS.ProcessEnv = process.env) {
  const config = readConfigAgentRuntimeConfig(environment);
  const service = new RetentionService({ stateDirectory: config.stateDirectory });
  return service.cleanup();
}

export function runConfigAgentCleanupEntrypoint(
  input: {
    environment?: NodeJS.ProcessEnv;
    telemetry?: RuntimeTelemetry;
    run?: () => Promise<unknown>;
    onFailure?: (error: unknown) => void | Promise<void>;
    rethrow?: boolean;
  } = {}
): Promise<unknown> {
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
        service: 'edutrack-ops-config-agent-cleanup',
        spoolName: 'config-agent-cleanup'
      }),
    failureContext: {
      code: 'CONFIG_AGENT_CLEANUP_FAILED',
      source: 'job' as const,
      level: 'fatal' as const
    },
    run: input.run ?? (() => runConfigAgentCleanup(environment)),
    ...(input.onFailure ? { onFailure: input.onFailure } : {})
  };
  return input.rethrow === false
    ? runConfiguredOpsTelemetryOneShot({ ...common, rethrow: false })
    : runConfiguredOpsTelemetryOneShot({ ...common, rethrow: true });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void runConfigAgentCleanupEntrypoint({
    rethrow: false,
    onFailure: () => {
      process.stderr.write('CONFIG_AGENT_CLEANUP_FAILED\n');
      process.exitCode = 1;
    }
  });
}
