import { join } from 'node:path';

import {
  createConfiguredRuntimeTelemetry,
  type RuntimeTelemetry
} from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
export {
  captureOpsException,
  flushOpsRuntimeTelemetry,
  flushRuntimeTelemetryFailOpen,
  installOpsRuntimeTelemetry
} from '../../../../packages/telemetry-sdk/src/runtimeCaptureFacade.js';

type ConfiguredTelemetryInput = Parameters<typeof createConfiguredRuntimeTelemetry>[0];
export function createConfigAgentRuntimeTelemetry(
  input: Omit<ConfiguredTelemetryInput, 'service' | 'spoolDirectory'>
): RuntimeTelemetry {
  return createConfiguredRuntimeTelemetry({
    ...input,
    service: 'edutrack-ops-config-agent',
    spoolDirectory: join(input.config.spoolDirectory, 'config-agent')
  });
}
