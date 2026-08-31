export type HealthCheckDefinition = Readonly<{
  id: string;
  kind: 'process_stable' | 'http' | 'release_identity' | 'dependency' | 'agent_self' | 'api_health';
  target?: string;
  timeoutMs: number;
  observationMs?: number;
  protocol?: 'http' | 'https';
  host?: string;
  port?: number;
  path?: string;
  maxBodyBytes?: number;
  allowRedirects?: boolean;
}>;

export type HealthProbeDependencies = Readonly<{
  processProbe: (target: string) => Promise<Readonly<{ active: boolean; stable: boolean }>>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  identityProbe: (target: string) => Promise<Readonly<{ releaseId: string; configDigest: string }>>;
  dependencyProbe?: (target: string) => Promise<boolean>;
  agentProbe?: () => Promise<boolean>;
  apiProbe?: (target: string) => Promise<boolean>;
}>;

export type HealthRunInput = Readonly<{
  runId: string;
  checkIds: readonly string[];
  expectedReleaseId?: string;
  expectedConfigDigest?: string;
}>;

export type HealthResult = Readonly<{
  runId: string;
  checkId: string;
  outcome: 'passed' | 'failed';
  reasonCode: string;
  durationMs: number;
  attempts: number;
}>;

export type HealthCheckErrorCode = 'HEALTH_INPUT_INVALID' | 'HEALTH_CHECK_NOT_ALLOWED';

export class HealthCheckRunnerError extends Error {
  readonly code: HealthCheckErrorCode;

  constructor(code: HealthCheckErrorCode) {
    super(code);
    this.name = 'HealthCheckRunnerError';
    this.code = code;
  }
}

function fail(code: HealthCheckErrorCode): never {
  throw new HealthCheckRunnerError(code);
}

function timeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<boolean> {
  if (!response.body) {
    const body = await response.arrayBuffer();
    return body.byteLength <= maximumBytes;
  }
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return true;
      total += chunk.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return false;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function validateDefinition(definition: HealthCheckDefinition): void {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(definition.id)) fail('HEALTH_INPUT_INVALID');
  if (definition.kind !== 'http' && !definition.target) fail('HEALTH_INPUT_INVALID');
  if (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0 || definition.timeoutMs > 300_000) fail('HEALTH_INPUT_INVALID');
  if (definition.kind === 'http') {
    if (
      (definition.protocol !== 'http' && definition.protocol !== 'https') ||
      !definition.host ||
      !/^[A-Za-z0-9.-]+$/u.test(definition.host) ||
      !Number.isInteger(definition.port) ||
      (definition.port ?? 0) < 1 ||
      (definition.port ?? 0) > 65_535 ||
      !definition.path?.startsWith('/') ||
      definition.path.includes('\u0000') ||
      !Number.isSafeInteger(definition.maxBodyBytes) ||
      (definition.maxBodyBytes ?? 0) <= 0
    ) {
      fail('HEALTH_INPUT_INVALID');
    }
  }
}

function result(
  runId: string,
  checkId: string,
  outcome: HealthResult['outcome'],
  reasonCode: string,
  startedAt: number
): HealthResult {
  return { runId, checkId, outcome, reasonCode, durationMs: Date.now() - startedAt, attempts: 1 };
}

export function createHealthCheckRunner(options: Readonly<{
  definitions: readonly HealthCheckDefinition[];
  dependencies: HealthProbeDependencies;
}>) {
  const definitions = new Map<string, HealthCheckDefinition>();
  for (const definition of options.definitions) {
    validateDefinition(definition);
    if (definitions.has(definition.id)) fail('HEALTH_INPUT_INVALID');
    definitions.set(definition.id, definition);
  }

  async function execute(
    runId: string,
    definition: HealthCheckDefinition,
    input: HealthRunInput
  ): Promise<HealthResult> {
    const startedAt = Date.now();
    try {
      switch (definition.kind) {
        case 'process_stable': {
          const process = await timeout(options.dependencies.processProbe(definition.target ?? ''), definition.timeoutMs);
          if (!process.active) return result(runId, definition.id, 'failed', 'PROCESS_INACTIVE', startedAt);
          if (!process.stable) return result(runId, definition.id, 'failed', 'PROCESS_UNSTABLE', startedAt);
          return result(runId, definition.id, 'passed', 'OK', startedAt);
        }
        case 'http': {
          const url = `${definition.protocol}://${definition.host}:${definition.port}${definition.path}`;
          const response = await timeout(
            options.dependencies.fetch(url, { redirect: definition.allowRedirects ? 'follow' : 'manual' }),
            definition.timeoutMs
          );
          if (!definition.allowRedirects && (response.redirected || (response.status >= 300 && response.status < 400))) {
            return result(runId, definition.id, 'failed', 'HTTP_REDIRECT_REJECTED', startedAt);
          }
          if (definition.allowRedirects && response.redirected && response.url) {
            const finalUrl = new URL(response.url);
            if (finalUrl.hostname !== definition.host || finalUrl.protocol !== `${definition.protocol}:`) {
              return result(runId, definition.id, 'failed', 'HTTP_TARGET_REJECTED', startedAt);
            }
          }
          if (!response.ok) return result(runId, definition.id, 'failed', 'HTTP_STATUS_UNEXPECTED', startedAt);
          const bodyAllowed = await timeout(readBoundedBody(response, definition.maxBodyBytes ?? 0), definition.timeoutMs);
          if (!bodyAllowed) {
            return result(runId, definition.id, 'failed', 'HTTP_BODY_TOO_LARGE', startedAt);
          }
          return result(runId, definition.id, 'passed', 'OK', startedAt);
        }
        case 'release_identity': {
          if (!input.expectedReleaseId || !input.expectedConfigDigest) {
            return result(runId, definition.id, 'failed', 'RELEASE_IDENTITY_MISSING', startedAt);
          }
          const identity = await timeout(options.dependencies.identityProbe(definition.target ?? ''), definition.timeoutMs);
          if (identity.releaseId !== input.expectedReleaseId || identity.configDigest !== input.expectedConfigDigest) {
            return result(runId, definition.id, 'failed', 'RELEASE_IDENTITY_MISMATCH', startedAt);
          }
          return result(runId, definition.id, 'passed', 'OK', startedAt);
        }
        case 'dependency': {
          if (!options.dependencies.dependencyProbe) return result(runId, definition.id, 'failed', 'CHECK_UNAVAILABLE', startedAt);
          const dependencyPassed = await timeout(options.dependencies.dependencyProbe(definition.target ?? ''), definition.timeoutMs);
          return result(runId, definition.id, dependencyPassed ? 'passed' : 'failed', dependencyPassed ? 'OK' : 'DEPENDENCY_FAILED', startedAt);
        }
        case 'agent_self': {
          if (!options.dependencies.agentProbe) return result(runId, definition.id, 'failed', 'CHECK_UNAVAILABLE', startedAt);
          const agentPassed = await timeout(options.dependencies.agentProbe(), definition.timeoutMs);
          return result(runId, definition.id, agentPassed ? 'passed' : 'failed', agentPassed ? 'OK' : 'AGENT_UNHEALTHY', startedAt);
        }
        case 'api_health': {
          if (!options.dependencies.apiProbe) return result(runId, definition.id, 'failed', 'CHECK_UNAVAILABLE', startedAt);
          const apiPassed = await timeout(options.dependencies.apiProbe(definition.target ?? ''), definition.timeoutMs);
          return result(runId, definition.id, apiPassed ? 'passed' : 'failed', apiPassed ? 'OK' : 'API_UNHEALTHY', startedAt);
        }
      }
    } catch {
      return result(runId, definition.id, 'failed', definition.kind === 'http' ? 'HTTP_TIMEOUT' : 'CHECK_TIMEOUT', startedAt);
    }
  }

  async function run(input: HealthRunInput): Promise<HealthResult[]> {
    if (
      !input ||
      typeof input.runId !== 'string' ||
      !Array.isArray(input.checkIds) ||
      Object.keys(input).some((key) => !['runId', 'checkIds', 'expectedReleaseId', 'expectedConfigDigest'].includes(key))
    ) {
      fail('HEALTH_INPUT_INVALID');
    }
    const results: HealthResult[] = [];
    for (const checkId of input.checkIds) {
      const definition = definitions.get(checkId);
      if (!definition) fail('HEALTH_CHECK_NOT_ALLOWED');
      results.push(await execute(input.runId, definition, input));
    }
    return results;
  }

  return { run };
}
