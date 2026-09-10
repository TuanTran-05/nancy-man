export {
  createConfiguredRuntimeTelemetry,
  createRuntimeTelemetry,
  startRuntimeTelemetryMaintenance
} from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
export type { RuntimeTelemetry } from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
export {
  captureOpsException,
  flushOpsRuntimeTelemetry,
  flushRuntimeTelemetryFailOpen,
  installOpsRuntimeTelemetry
} from '../../../../packages/telemetry-sdk/src/runtimeCaptureFacade.js';
