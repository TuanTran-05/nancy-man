import { join } from 'node:path';

import { installNodeTelemetryLifecycle } from './nodeLifecycle.js';
import {
  createConfiguredRuntimeTelemetry,
  createRuntimeTelemetry,
  type RuntimeTelemetry
} from './runtimeTelemetry.js';
import {
  captureOpsException,
  flushRuntimeTelemetryFailOpen,
  installOpsRuntimeTelemetry,
  type OpsRuntimeCaptureContext
} from './runtimeCaptureFacade.js';
import {
  readServerTelemetryRuntimeConfig,
  type ServerTelemetryRuntimeConfig
} from './serverRuntimeConfig.js';

type ConfiguredRuntimeInput = Parameters<typeof createConfiguredRuntimeTelemetry>[0];

export function createOpsProcessRuntimeTelemetry(input: {
  config: ServerTelemetryRuntimeConfig;
  hmacSecret?: string;
  service: string;
  spoolName: string;
  spool?: ConfiguredRuntimeInput['spool'];
  fetch?: ConfiguredRuntimeInput['fetch'];
}): RuntimeTelemetry {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(input.spoolName)) {
    throw new Error('OPS_TELEMETRY_SPOOL_NAME_INVALID');
  }
  if (!input.config.enabled) {
    return createRuntimeTelemetry({
      enabled: false,
      release: '0000000000000000000000000000000000000000',
      service: input.service,
      transport: async () => undefined
    });
  }
  if (!input.hmacSecret) throw new Error('OPS_TELEMETRY_HMAC_UNAVAILABLE');
  return createConfiguredRuntimeTelemetry({
    config: input.config,
    hmacSecret: input.hmacSecret,
    service: input.service,
    spoolDirectory: join(input.config.spoolDirectory, input.spoolName),
    ...(input.spool ? { spool: input.spool } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {})
  });
}

export async function createOpsProcessRuntimeTelemetryFromEnvironment(input: {
  environment: Readonly<Record<string, string | undefined>>;
  resolveHmacSecret: (reference: string) => Promise<string | null | undefined>;
  service: string;
  spoolName: string;
  spool?: ConfiguredRuntimeInput['spool'];
  fetch?: ConfiguredRuntimeInput['fetch'];
}): Promise<RuntimeTelemetry> {
  const config = readServerTelemetryRuntimeConfig(input.environment);
  const hmacSecret = config.enabled
    ? (await input.resolveHmacSecret(config.hmacSecretReference))?.trim()
    : undefined;
  return createOpsProcessRuntimeTelemetry({
    config,
    ...(hmacSecret ? { hmacSecret } : {}),
    service: input.service,
    spoolName: input.spoolName,
    ...(input.spool ? { spool: input.spool } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {})
  });
}

type OpsTelemetryOneShotInput<Result> = {
  telemetry: RuntimeTelemetry;
  failureContext: OpsRuntimeCaptureContext;
  run: () => Result | Promise<Result>;
  onFailure?: (error: unknown) => void | Promise<void>;
  handleProcessSignals?: boolean;
};

export function runOpsTelemetryOneShot<Result>(
  input: OpsTelemetryOneShotInput<Result> & { rethrow: false }
): Promise<Result | undefined>;
export function runOpsTelemetryOneShot<Result>(
  input: OpsTelemetryOneShotInput<Result> & { rethrow?: true }
): Promise<Result>;
export async function runOpsTelemetryOneShot<Result>(
  input: OpsTelemetryOneShotInput<Result> & { rethrow?: boolean }
): Promise<Result | undefined> {
  const disposeRuntimeTelemetry = installOpsRuntimeTelemetry(input.telemetry);
  const disposeNodeTelemetryLifecycle = installNodeTelemetryLifecycle({
    captureException: captureOpsException,
    flush: input.telemetry.flush,
    handleSignals: input.handleProcessSignals ?? true,
    exit: (code) => process.exit(code)
  });
  try {
    return await input.run();
  } catch (error) {
    captureOpsException(error, input.failureContext);
    try {
      await input.onFailure?.(error);
    } catch {
      // Terminal diagnostics must not replace or resurface the originating command failure.
    }
    if (input.rethrow !== false) throw error;
    return undefined;
  } finally {
    try {
      await flushRuntimeTelemetryFailOpen(input.telemetry);
    } finally {
      disposeNodeTelemetryLifecycle();
      disposeRuntimeTelemetry();
    }
  }
}

type ConfiguredOpsTelemetryOneShotInput<Result> = Omit<
  OpsTelemetryOneShotInput<Result>,
  'telemetry'
> & {
  createTelemetry: () => RuntimeTelemetry | Promise<RuntimeTelemetry>;
};

export function runConfiguredOpsTelemetryOneShot<Result>(
  input: ConfiguredOpsTelemetryOneShotInput<Result> & { rethrow: false }
): Promise<Result | undefined>;
export function runConfiguredOpsTelemetryOneShot<Result>(
  input: ConfiguredOpsTelemetryOneShotInput<Result> & { rethrow?: true }
): Promise<Result>;
export async function runConfiguredOpsTelemetryOneShot<Result>(
  input: ConfiguredOpsTelemetryOneShotInput<Result> & { rethrow?: boolean }
): Promise<Result | undefined> {
  let telemetry: RuntimeTelemetry;
  try {
    telemetry = await input.createTelemetry();
  } catch (error) {
    try {
      await input.onFailure?.(error);
    } catch {
      // A bootstrap diagnostic must not replace the telemetry bootstrap failure.
    }
    if (input.rethrow !== false) throw error;
    return undefined;
  }
  const common = {
    telemetry,
    failureContext: input.failureContext,
    run: input.run,
    ...(input.handleProcessSignals === undefined
      ? {}
      : { handleProcessSignals: input.handleProcessSignals }),
    ...(input.onFailure ? { onFailure: input.onFailure } : {})
  };
  return input.rethrow === false
    ? runOpsTelemetryOneShot({ ...common, rethrow: false })
    : runOpsTelemetryOneShot({ ...common, rethrow: true });
}
