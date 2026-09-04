import { join } from 'node:path';

import {
  createConfiguredRuntimeTelemetry,
  type RuntimeTelemetry
} from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';

type ConfiguredTelemetryInput = Parameters<typeof createConfiguredRuntimeTelemetry>[0];

export function createNotifierRuntimeTelemetry(
  input: Omit<ConfiguredTelemetryInput, 'service' | 'spoolDirectory'>
): RuntimeTelemetry {
  return createConfiguredRuntimeTelemetry({
    ...input,
    service: 'edutrack-ops-notifier',
    spoolDirectory: join(input.config.spoolDirectory, 'notifier')
  });
}
