import { spawn } from 'node:child_process';

export type ProcessSpec = Readonly<{
  executable: string;
  args: readonly string[];
  cwd?: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
}>;

export type ProcessResult = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutBytes: number;
  stderrBytes: number;
  timedOut: boolean;
  outputLimitExceeded?: boolean;
}>;

export type ProcessExecutor = (spec: ProcessSpec) => Promise<ProcessResult>;

export type FixedActionDefinition = Readonly<{
  id: string;
  strategy: 'no_runtime_action' | 'next_job' | 'runtime_restart' | 'credential_restart' | 'build_redeploy';
  executable: string | null;
  args: readonly string[];
  cwd?: string;
  environment: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
}>;

export type BuildIdentity = Readonly<{
  sourceSha: string;
  configDigest: string;
  releaseId: string;
}>;

export type BuildRedeployHandler = (input: Readonly<{
  runId: string;
  actionId: 'release.build_redeploy';
  identity: BuildIdentity;
}>) => Promise<ProcessResult>;

export type ActionRunnerOptions = Readonly<{
  definitions: readonly FixedActionDefinition[];
  executor?: ProcessExecutor;
  buildRedeploy?: BuildRedeployHandler;
  rollbackBuildRedeploy?: BuildRedeployHandler;
}>;

export type ActionRunInput = Readonly<{
  runId: string;
  actionId: string;
  buildIdentity?: BuildIdentity;
}>;

export type ActionResult = Readonly<{
  runId: string;
  actionId: string;
  outcome: 'completed' | 'takes_effect_next_run';
  durationMs: number;
}>;

export type ActionRunnerErrorCode =
  | 'ACTION_INPUT_INVALID'
  | 'ACTION_NOT_ALLOWED'
  | 'ACTION_FAILED'
  | 'ACTION_TIMED_OUT'
  | 'ACTION_OUTPUT_LIMIT'
  | 'BUILD_IDENTITY_INVALID';

export class ActionRunnerError extends Error {
  readonly code: ActionRunnerErrorCode;

  constructor(code: ActionRunnerErrorCode) {
    super(code);
    this.name = 'ActionRunnerError';
    this.code = code;
  }
}

function fail(code: ActionRunnerErrorCode): never {
  throw new ActionRunnerError(code);
}

function validBuildIdentity(identity: BuildIdentity): boolean {
  return (
    /^[0-9a-f]{40}$/u.test(identity.sourceSha) &&
    /^[0-9a-f]{64}$/u.test(identity.configDigest) &&
    identity.releaseId === `${identity.sourceSha}-cfg-${identity.configDigest}`
  );
}

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

export const executeFixedProcess: ProcessExecutor = (spec) =>
  new Promise((resolve) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;
    const child = spawn(spec.executable, [...spec.args], {
      cwd: spec.cwd,
      env: { ...spec.env },
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const finish = (result: ProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const count = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      if (stream === 'stdout') stdoutBytes += chunk.byteLength;
      else stderrBytes += chunk.byteLength;
      if (stdoutBytes + stderrBytes > spec.maxOutputBytes) {
        outputLimitExceeded = true;
        killProcessGroup(child.pid);
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => count(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => count(chunk, 'stderr'));
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid);
    }, spec.timeoutMs);
    child.once('error', () => {
      finish({ exitCode: null, signal: null, stdoutBytes, stderrBytes, timedOut, outputLimitExceeded });
    });
    child.once('close', (exitCode, signal) => {
      finish({ exitCode, signal, stdoutBytes, stderrBytes, timedOut, outputLimitExceeded });
    });
  });

function validateDefinition(definition: FixedActionDefinition): void {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(definition.id)) fail('ACTION_INPUT_INVALID');
  if (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0 || definition.timeoutMs > 300_000) {
    fail('ACTION_INPUT_INVALID');
  }
  if (!Number.isSafeInteger(definition.maxOutputBytes) || definition.maxOutputBytes <= 0 || definition.maxOutputBytes > 1_048_576) {
    fail('ACTION_INPUT_INVALID');
  }
  if (definition.executable !== null && (!definition.executable.startsWith('/') || definition.executable.includes('\u0000'))) {
    fail('ACTION_INPUT_INVALID');
  }
}

function isSuccess(result: ProcessResult): boolean {
  return result.exitCode === 0 && result.signal === null && !result.timedOut && !result.outputLimitExceeded;
}

export function createActionRunner(options: ActionRunnerOptions) {
  const definitions = new Map<string, FixedActionDefinition>();
  for (const definition of options.definitions) {
    validateDefinition(definition);
    if (definitions.has(definition.id)) fail('ACTION_INPUT_INVALID');
    definitions.set(definition.id, definition);
  }
  const execute = options.executor ?? executeFixedProcess;
  const replay = new Map<string, Promise<ActionResult>>();

  async function run(input: ActionRunInput): Promise<ActionResult> {
    if (
      !input ||
      typeof input.runId !== 'string' ||
      typeof input.actionId !== 'string' ||
      Object.keys(input).some((key) => !['runId', 'actionId', 'buildIdentity'].includes(key))
    ) {
      fail('ACTION_INPUT_INVALID');
    }
    const definition = definitions.get(input.actionId);
    if (!definition) fail('ACTION_NOT_ALLOWED');
    const replayKey = `${input.runId}\u0000${input.actionId}`;
    const existing = replay.get(replayKey);
    if (existing) return existing;
    const startedAt = Date.now();
    const operation = (async (): Promise<ActionResult> => {
      if (definition.strategy === 'next_job') {
        return {
          runId: input.runId,
          actionId: input.actionId,
          outcome: 'takes_effect_next_run',
          durationMs: Date.now() - startedAt
        };
      }
      if (definition.strategy === 'no_runtime_action') {
        return { runId: input.runId, actionId: input.actionId, outcome: 'completed', durationMs: Date.now() - startedAt };
      }
      let result: ProcessResult;
      if (definition.id === 'release.build_redeploy') {
        if (!input.buildIdentity || !validBuildIdentity(input.buildIdentity) || !options.buildRedeploy) {
          if (!input.buildIdentity || !validBuildIdentity(input.buildIdentity)) fail('BUILD_IDENTITY_INVALID');
          fail('ACTION_NOT_ALLOWED');
        }
        result = await options.buildRedeploy({ runId: input.runId, actionId: 'release.build_redeploy', identity: input.buildIdentity });
      } else {
        if (!definition.executable) fail('ACTION_NOT_ALLOWED');
        result = await execute({
          executable: definition.executable,
          args: definition.args,
          env: definition.environment,
          timeoutMs: definition.timeoutMs,
          maxOutputBytes: definition.maxOutputBytes,
          ...(definition.cwd === undefined ? {} : { cwd: definition.cwd })
        });
      }
      if (result.timedOut) fail('ACTION_TIMED_OUT');
      if (result.outputLimitExceeded) fail('ACTION_OUTPUT_LIMIT');
      if (!isSuccess(result)) fail('ACTION_FAILED');
      return { runId: input.runId, actionId: input.actionId, outcome: 'completed', durationMs: Date.now() - startedAt };
    })();
    replay.set(replayKey, operation);
    return operation;
  }

  async function rollback(input: ActionRunInput): Promise<ActionResult> {
    if (input.actionId !== 'release.build_redeploy' || !input.buildIdentity || !validBuildIdentity(input.buildIdentity) || !options.rollbackBuildRedeploy) {
      fail('ACTION_NOT_ALLOWED');
    }
    const startedAt = Date.now();
    const result = await options.rollbackBuildRedeploy({ runId: input.runId, actionId: 'release.build_redeploy', identity: input.buildIdentity });
    if (!isSuccess(result)) fail(result.timedOut ? 'ACTION_TIMED_OUT' : 'ACTION_FAILED');
    return { runId: input.runId, actionId: input.actionId, outcome: 'completed', durationMs: Date.now() - startedAt };
  }

  return { run, rollback };
}
