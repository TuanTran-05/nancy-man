import { join } from 'node:path';

import {
  createConfiguredRuntimeTelemetry,
  type RuntimeTelemetry
} from '../../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';

type ConfiguredTelemetryInput = Parameters<typeof createConfiguredRuntimeTelemetry>[0];

function createServiceRuntimeTelemetry(
  input: Omit<ConfiguredTelemetryInput, 'service' | 'spoolDirectory'>,
  service: 'edutrack-ops-web' | 'edutrack-ops-collector',
  spoolName: 'web' | 'collector'
): RuntimeTelemetry {
  return createConfiguredRuntimeTelemetry({
    ...input,
    service,
    spoolDirectory: join(input.config.spoolDirectory, spoolName)
  });
}

export function createWebRuntimeTelemetry(
  input: Omit<ConfiguredTelemetryInput, 'service' | 'spoolDirectory'>
): RuntimeTelemetry {
  return createServiceRuntimeTelemetry(input, 'edutrack-ops-web', 'web');
}

export function createCollectorRuntimeTelemetry(
  input: Omit<ConfiguredTelemetryInput, 'service' | 'spoolDirectory'>
): RuntimeTelemetry {
  return createServiceRuntimeTelemetry(input, 'edutrack-ops-collector', 'collector');
}
