import { join } from 'node:path';

import {
  createConfiguredRuntimeTelemetry,
  type RuntimeTelemetry
} from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';

type ConfiguredTelemetryInput = Parameters<typeof createConfiguredRuntimeTelemetry>[0];

export function createProcessorRuntimeTelemetry(
  input: Omit<ConfiguredTelemetryInput, 'service' | 'spoolDirectory'>
): RuntimeTelemetry {
  return createConfiguredRuntimeTelemetry({
    ...input,
    service: 'edutrack-ops-processor',
    spoolDirectory: join(input.config.spoolDirectory, 'processor')
  });
}
