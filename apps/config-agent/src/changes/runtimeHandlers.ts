import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type {
  AgentActor,
  ChangeApplyRequest,
  ChangeCancelRequest,
  ChangeSaveRequest,
  ChangeStatusRequest,
  ChangeValidateRequest,
  ClearApplyBlockRequest,
  ChangeStatusResponse
} from '../../../../packages/config-contracts/src/index.js';
import type { LoadedCatalogAndManifest } from '../manifestLoader.js';
import type { ConfigAgentRuntimeConfig } from '../runtimeConfig.js';
import type { FingerprintKey } from '../inventory/fingerprint.js';
import { fingerprintSource } from '../inventory/fingerprint.js';
import { nodeEnvFileAdapter } from '../adapters/nodeEnvFile.js';
import { DraftStore } from './draftStore.js';
import { SnapshotStore } from './snapshotStore.js';
import { createValidationService, type ValidatedChangeDraft } from './validationService.js';
import { createAtomicSourceWriter } from './atomicSourceWriter.js';
import {
  createActionRunner,
  executeFixedProcess,
  type BuildIdentity,
  type ProcessExecutor
} from './actionRunner.js';
import { createHealthCheckRunner } from './healthCheckRunner.js';
import {
  createApplyCoordinator,
  type ApplyEvent,
  type SnapshotPayload,
  type StagedChangePayload
} from './applyCoordinator.js';
import { createChangeRecovery, type RecoveryRecord } from './changeRecovery.js';
import type { AgentMutationHandlers } from '../protocol/authenticatedServer.js';

type RuntimeEvent = Readonly<{
  eventId: string;
  changeId: string;
  sequence: number;
  state: ChangeStatusResponse['state'];
  reasonCode: string;
  occurredAt: string;
}>;

type RuntimeChange = {
  changeId: string;
  appId: string;
  state: ChangeStatusResponse['state'];
  sequence: number;
  changeDigest?: string;
  impactPlan?: ChangeStatusResponse['impactPlan'];
  events: RuntimeEvent[];
};

type ProcessResult = Awaited<ReturnType<typeof executeFixedProcess>>;

const recoveryStates = new Set<RuntimeEvent['state']>([
  'APPLYING',
  'SNAPSHOTTED',
  'WRITTEN',
  'ACTION_RUNNING',
  'HEALTH_CHECKING',
  'ROLLING_BACK',
  'COMPLETED',
  'ROLLED_BACK',
  'ROLLBACK_FAILED'
]);

export type RuntimeMutationHandlerOptions = Readonly<{
  config: ConfigAgentRuntimeConfig;
  loaded: LoadedCatalogAndManifest;
  fingerprintKey: FingerprintKey;
  stagingKey: ConstructorParameters<typeof DraftStore>[0]['stagingKey'];
  stagingKeys?: readonly ConstructorParameters<typeof DraftStore>[0]['stagingKey'][];
  snapshotKey: ConstructorParameters<typeof SnapshotStore>[0]['snapshotKey'];
  snapshotKeys?: readonly ConstructorParameters<typeof SnapshotStore>[0]['snapshotKey'][];
  executor?: ProcessExecutor;
  buildRedeploy?: (
    input: Readonly<{ runId: string; identity: BuildIdentity }>
  ) => Promise<ProcessResult>;
}>;

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function valueFreeDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

const buildEnvironmentName = /^[A-Z][A-Z0-9_]*$/u;

function containsForbiddenBuildEnvironmentControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function serializeBuildEnvironment(environment: Readonly<Record<string, string>>): string {
  return `${Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      if (!buildEnvironmentName.test(name) || containsForbiddenBuildEnvironmentControl(value)) {
        throw Object.assign(new Error('BUILD_ENVIRONMENT_INVALID'), {
          code: 'BUILD_ENVIRONMENT_INVALID'
        });
      }
      return `${name}=${value}`;
    })
    .join('\n')}\n`;
}

type ActiveRelease = Readonly<{ sourceSha: string; releaseId?: string }>;

function currentRelease(
  build: NonNullable<LoadedCatalogAndManifest['manifest']['build']>
): ActiveRelease {
  const current = join(build.releaseRoot, 'current');
  let releaseName: string;
  try {
    releaseName = basename(readlinkSync(current));
  } catch {
    throw Object.assign(new Error('BUILD_SOURCE_UNAVAILABLE'), {
      code: 'BUILD_SOURCE_UNAVAILABLE'
    });
  }
  const match = /^(?<sourceSha>[0-9a-f]{40})(?<derived>-cfg-[0-9a-f]{64})?$/u.exec(releaseName);
  const releasesPath = join(build.releaseRoot, 'releases');
  const rawTarget = join(releasesPath, releaseName);
  const releasesStat = lstatSync(releasesPath, { throwIfNoEntry: false });
  const targetStat = lstatSync(rawTarget, { throwIfNoEntry: false });
  if (
    !releasesStat?.isDirectory() ||
    releasesStat.isSymbolicLink() ||
    !targetStat?.isDirectory() ||
    targetStat.isSymbolicLink() ||
    !match?.groups?.sourceSha
  ) {
    throw Object.assign(new Error('BUILD_SOURCE_INVALID'), { code: 'BUILD_SOURCE_INVALID' });
  }
  const releasesRoot = realpathSync(releasesPath);
  const target = realpathSync(rawTarget);
  if (target !== realpathSync(current) || !target.startsWith(`${releasesRoot}/`)) {
    throw Object.assign(new Error('BUILD_SOURCE_INVALID'), { code: 'BUILD_SOURCE_INVALID' });
  }
  return {
    sourceSha: match.groups.sourceSha,
    ...(match.groups.derived ? { releaseId: releaseName } : {})
  };
}

function lockFactory(root: string) {
  const tails = new Map<string, Promise<void>>();
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

  return async (key: string): Promise<() => void> => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(
      key,
      previous.then(() => current)
    );
    await previous;
    const lockPath = join(root, `lock-${createHash('sha256').update(key, 'utf8').digest('hex')}`);
    let acquired = false;
    try {
      while (!acquired) {
        try {
          mkdirSync(lockPath, { mode: 0o700 });
          try {
            writeFileSync(join(lockPath, 'owner'), `${process.pid}\n`, {
              mode: 0o600,
              flag: 'wx'
            });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
          }
          acquired = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          let ownerPid: number | undefined;
          try {
            ownerPid = Number(readFileSync(join(lockPath, 'owner'), 'utf8').trim());
          } catch {
            ownerPid = undefined;
          }
          let ownerAlive = false;
          if (ownerPid && Number.isSafeInteger(ownerPid) && ownerPid > 0) {
            try {
              process.kill(ownerPid, 0);
              ownerAlive = true;
            } catch (probeError) {
              ownerAlive = (probeError as NodeJS.ErrnoException).code !== 'ESRCH';
            }
          }
          if (!ownerAlive) rmSync(lockPath, { recursive: true, force: true });
          else await pause();
        }
      }
    } catch (error) {
      release();
      throw error;
    }
    return () => {
      if (acquired) {
        acquired = false;
        rmSync(lockPath, { recursive: true, force: true });
      }
      release();
    };
  };
}

function strategyForAction(
  idValue: string
): 'no_runtime_action' | 'next_job' | 'runtime_restart' | 'credential_restart' | 'build_redeploy' {
  if (idValue === 'job.next_run') return 'next_job';
  if (idValue === 'release.build_redeploy') return 'build_redeploy';
  if (idValue === 'systemd.restart_unit') return 'credential_restart';
  if (idValue === 'pm2.reload_app' || idValue === 'systemd.reload_unit') return 'runtime_restart';
  return 'no_runtime_action';
}

function checkKind(
  idValue: string
): 'process_stable' | 'http' | 'release_identity' | 'dependency' | 'agent_self' | 'api_health' {
  if (idValue === 'process.active') return 'process_stable';
  if (idValue === 'release.identity') return 'release_identity';
  if (idValue === 'dependency.probe') return 'dependency';
  if (idValue === 'agent.healthy') return 'agent_self';
  if (idValue === 'http.smoke_public') return 'http';
  if (idValue === 'http.readiness_local') return 'http';
  return 'api_health';
}

async function buildInputsFor(
  change: StagedChangePayload,
  catalog: LoadedCatalogAndManifest['catalog'],
  manifest: LoadedCatalogAndManifest['manifest'],
  writer: ReturnType<typeof createAtomicSourceWriter>
): Promise<{ identity: BuildIdentity; environment: Readonly<Record<string, string>> }> {
  const build = manifest.build;
  if (!build)
    throw Object.assign(new Error('BUILD_MANIFEST_MISSING'), { code: 'BUILD_MANIFEST_MISSING' });
  const allowedIds = new Set(build.publicCatalogIds);
  const entries = catalog.entries
    .filter((entry) => allowedIds.has(entry.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (entries.length !== allowedIds.size) {
    throw Object.assign(new Error('PUBLIC_BUILD_NOT_ALLOWED'), {
      code: 'PUBLIC_BUILD_NOT_ALLOWED'
    });
  }
  const proposed = new Map(
    change.items.map((item) => [`${item.sourceId}\u0000${item.name}`, item])
  );
  const currentValues = new Map<string, string>();
  const parsedBySource = new Map<string, ReturnType<typeof nodeEnvFileAdapter.parse>>();
  for (const entry of entries) {
    if (entry.sensitivity !== 'public' || entry.buildAllowed !== true) {
      throw Object.assign(new Error('PUBLIC_BUILD_NOT_ALLOWED'), {
        code: 'PUBLIC_BUILD_NOT_ALLOWED'
      });
    }
    let parsed = parsedBySource.get(entry.sourceId);
    if (!parsed) {
      const source = manifest.sources.find((candidate) => candidate.id === entry.sourceId);
      if (!source || source.adapterId !== 'node_env_file') {
        throw Object.assign(new Error('BUILD_SOURCE_UNSUPPORTED'), {
          code: 'BUILD_SOURCE_UNSUPPORTED'
        });
      }
      const current = await writer.readCurrent(source.id);
      parsed = nodeEnvFileAdapter.parse(current.bytes, { maximumBytes: source.maximumBytes });
      parsedBySource.set(entry.sourceId, parsed);
    }
    const definitions = parsed.definitions.filter((definition) => definition.name === entry.name);
    if (definitions.length !== 1) {
      throw Object.assign(new Error('PUBLIC_BUILD_INPUT_MISSING'), {
        code: 'PUBLIC_BUILD_INPUT_MISSING'
      });
    }
    const item = proposed.get(`${entry.sourceId}\u0000${entry.name}`);
    if (item?.operation === 'delete') continue;
    currentValues.set(entry.name, item?.value ?? definitions[0]!.value);
  }
  const publicValues = entries
    .filter((entry) => currentValues.has(entry.name))
    .map((entry) => ({
      catalogId: entry.id,
      name: entry.name,
      value: currentValues.get(entry.name)
    }))
    .sort((left, right) => left.catalogId.localeCompare(right.catalogId));
  const configDigest = valueFreeDigest(publicValues);
  const sourceSha = currentRelease(build).sourceSha;
  const environment: Record<string, string> = { NODE_ENV: 'production' };
  for (const [name, value] of currentValues) environment[name] = value;
  const espSiteKey = environment.VITE_ESP_TURNSTILE_SITE_KEY;
  if (espSiteKey) environment.STAFF_BUILD_ESP_TURNSTILE_SITE_KEY = espSiteKey;
  return {
    identity: { sourceSha, configDigest, releaseId: `${sourceSha}-cfg-${configDigest}` },
    environment
  };
}

function asStaged(value: ValidatedChangeDraft): StagedChangePayload {
  return value;
}

export function createRuntimeMutationHandlers(
  options: RuntimeMutationHandlerOptions
): AgentMutationHandlers {
  const storage = { stateDirectory: options.config.stateDirectory } as const;
  const draftStore = new DraftStore({
    ...storage,
    stagingKey: options.stagingKey,
    ...(options.stagingKeys ? { stagingKeys: options.stagingKeys } : {}),
    draftTtlMs: options.config.draftTtlMs,
    stagedTtlMs: options.config.stagedTtlMs
  });
  const snapshotStore = new SnapshotStore({
    ...storage,
    snapshotKey: options.snapshotKey,
    ...(options.snapshotKeys ? { snapshotKeys: options.snapshotKeys } : {}),
    retentionMs: options.config.snapshotRetentionMs
  });
  const validation = createValidationService({
    catalog: options.loaded.catalog,
    manifest: options.loaded.manifest,
    fingerprintKey: options.fingerprintKey,
    draftStore
  });
  const writer = createAtomicSourceWriter({
    manifest: options.loaded.manifest,
    fingerprintKey: options.fingerprintKey
  });
  const locks = lockFactory(options.config.locksDirectory);
  const changes = new Map<string, RuntimeChange>();
  const runChanges = new Map<string, string>();
  const buildEnvironments = new Map<string, Readonly<Record<string, string>>>();
  const buildIdentities = new Map<string, BuildIdentity>();
  const previousBuildReleases = new Map<string, ActiveRelease | null>();
  const blockedApplications = new Set<string>();
  const journalPath = join(options.config.stateDirectory, 'locks', 'apply-journal.json');

  function journalRecords(): RecoveryRecord[] {
    mkdirSync(dirname(journalPath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(journalPath), 0o700);
    if (!existsSync(journalPath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(journalPath, 'utf8')) as unknown;
    } catch {
      throw new Error('CONFIG_AGENT_JOURNAL_INVALID');
    }
    if (!Array.isArray(parsed)) throw new Error('CONFIG_AGENT_JOURNAL_INVALID');
    const result: RecoveryRecord[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new Error('CONFIG_AGENT_JOURNAL_INVALID');
      const value = entry as Record<string, unknown>;
      if (
        typeof value.changeId !== 'string' ||
        typeof value.runId !== 'string' ||
        typeof value.appId !== 'string' ||
        typeof value.state !== 'string' ||
        !recoveryStates.has(value.state as RuntimeEvent['state']) ||
        typeof value.hasWrites !== 'boolean' ||
        (value.sequence !== undefined &&
          (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1)) ||
        (value.changeDigest !== undefined && typeof value.changeDigest !== 'string')
      )
        throw new Error('CONFIG_AGENT_JOURNAL_INVALID');
      const record = {
        changeId: value.changeId,
        runId: value.runId,
        appId: value.appId,
        state: value.state as RecoveryRecord['state'],
        hasWrites: value.hasWrites,
        ...(value.sequence === undefined ? {} : { sequence: Number(value.sequence) }),
        ...(value.changeDigest ? { changeDigest: value.changeDigest } : {}),
        ...(typeof value.buildReleaseId === 'string'
          ? { buildReleaseId: value.buildReleaseId }
          : {}),
        ...(typeof value.previousReleaseId === 'string'
          ? { previousReleaseId: value.previousReleaseId }
          : {})
      };
      result.push(record);
      runChanges.set(record.runId, record.changeId);
      if (record.state === 'ROLLBACK_FAILED') blockedApplications.add(record.appId);
    }
    return result;
  }

  function writeJournal(records: readonly RecoveryRecord[]): void {
    mkdirSync(dirname(journalPath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(journalPath), 0o700);
    const temporary = `${journalPath}.${process.pid}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try {
      const bytes = Buffer.from(`${JSON.stringify(records)}\n`, 'utf8');
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, journalPath);
    const directoryDescriptor = openSync(dirname(journalPath), 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }

  function persistRunMetadata(runId: string): void {
    const records = journalRecords();
    const existing = records.find((record) => record.runId === runId);
    if (!existing) return;
    const identity = buildIdentities.get(runId);
    const previous = previousBuildReleases.get(runId);
    writeJournal([
      ...records.filter((record) => record.runId !== runId),
      {
        ...existing,
        ...(identity ? { buildReleaseId: identity.releaseId } : {}),
        ...(previous ? { previousReleaseId: previous.releaseId ?? previous.sourceSha } : {})
      }
    ]);
  }

  for (const record of journalRecords()) {
    const current = stateFor(record.changeId, record.appId);
    current.state = record.state;
    current.sequence = record.sequence ?? current.sequence;
    if (record.changeDigest) current.changeDigest = record.changeDigest;
  }

  const definitions = options.loaded.manifest.actions.map((action) => ({
    id: action.id,
    strategy: strategyForAction(action.id),
    executable: action.executable ?? null,
    args: action.args ?? [],
    ...(action.workingDirectory ? { cwd: action.workingDirectory } : {}),
    environment: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' },
    timeoutMs: action.timeoutMs ?? 30_000,
    maxOutputBytes: 65_536
  }));

  const executor = options.executor ?? executeFixedProcess;
  const actionRunner = createActionRunner({
    definitions,
    executor,
    buildRedeploy: options.buildRedeploy
      ? async ({ runId, identity }) => options.buildRedeploy!({ runId, identity })
      : async ({ runId, identity }): Promise<ProcessResult> => {
          const build = options.loaded.manifest.build;
          if (!build)
            throw Object.assign(new Error('BUILD_MANIFEST_MISSING'), {
              code: 'BUILD_MANIFEST_MISSING'
            });
          const stagingRoot = build.buildRoot;
          const releaseScript = build.releaseScript;
          const activationScript = build.activationScript;
          const staging = mkdtempSync(join(stagingRoot, `config-${runId}-`));
          try {
            const environmentPath = join(staging, 'public-build.env');
            const environment = buildEnvironments.get(runId);
            if (!environment)
              throw Object.assign(new Error('BUILD_ENVIRONMENT_MISSING'), {
                code: 'BUILD_ENVIRONMENT_MISSING'
              });
            writeFileSync(environmentPath, serializeBuildEnvironment(environment), {
              mode: 0o600,
              flag: 'wx'
            });
            const processEnvironment = {
              PATH: '/usr/bin:/bin',
              NODE_ENV: 'production',
              APP_COMMIT_SHA: identity.sourceSha,
              APP_RELEASE_ID: identity.releaseId,
              APP_CONFIG_DIGEST: identity.configDigest,
              PLATFORM_SOURCE_REPOSITORY: build.repositoryRoot,
              PLATFORM_RELEASE_ROOT: build.releaseRoot,
              PLATFORM_BUILD_ROOT: build.buildRoot,
              PLATFORM_TOOLING_COMMIT: build.toolingCommit
            };
            const prepared = await executor({
              executable: '/usr/bin/bash',
              args: [
                releaseScript,
                '--source-sha',
                identity.sourceSha,
                '--release-id',
                identity.releaseId,
                '--config-digest',
                identity.configDigest,
                '--tooling-commit',
                build.toolingCommit,
                '--staging',
                staging
              ],
              cwd: build.releaseRoot,
              env: processEnvironment,
              timeoutMs: 300_000,
              maxOutputBytes: 65_536
            });
            if (
              prepared.exitCode !== 0 ||
              prepared.signal !== null ||
              prepared.timedOut ||
              prepared.outputLimitExceeded
            ) {
              return prepared;
            }
            previousBuildReleases.set(runId, currentRelease(build));
            return executor({
              executable: '/usr/bin/bash',
              args: [
                activationScript,
                '--source-sha',
                identity.sourceSha,
                '--release-id',
                identity.releaseId,
                '--config-digest',
                identity.configDigest
              ],
              cwd: build.releaseRoot,
              env: {
                ...processEnvironment,
                PLATFORM_TOOLING_COMMIT: build.toolingCommit,
                PLATFORM_PM2_VALIDATOR: build.activationValidatorPaths[0],
                PLATFORM_NGINX_VALIDATOR: build.activationValidatorPaths[1]
              },
              timeoutMs: 120_000,
              maxOutputBytes: 65_536
            });
          } finally {
            rmSync(staging, { recursive: true, force: true });
          }
        },
    rollbackBuildRedeploy: async ({ runId, identity }): Promise<ProcessResult> => {
      const build = options.loaded.manifest.build;
      const previous = build ? previousBuildReleases.get(runId) : undefined;
      if (!build || !previous) {
        throw Object.assign(new Error('BUILD_ROLLBACK_POINTER_UNAVAILABLE'), {
          code: 'BUILD_ROLLBACK_POINTER_UNAVAILABLE'
        });
      }
      const rollbackIdentity = previous.releaseId
        ? /^(?<sourceSha>[0-9a-f]{40})-cfg-(?<configDigest>[0-9a-f]{64})$/u.exec(previous.releaseId)
        : undefined;
      const args =
        previous.releaseId && rollbackIdentity?.groups
          ? [
              build.activationScript,
              '--source-sha',
              rollbackIdentity.groups.sourceSha!,
              '--release-id',
              previous.releaseId,
              '--config-digest',
              rollbackIdentity.groups.configDigest!
            ]
          : [build.activationScript, previous.sourceSha];
      return executor({
        executable: '/usr/bin/bash',
        args,
        cwd: build.releaseRoot,
        env: {
          PATH: '/usr/bin:/bin',
          NODE_ENV: 'production',
          APP_COMMIT_SHA: identity.sourceSha,
          APP_RELEASE_ID: identity.releaseId,
          APP_CONFIG_DIGEST: identity.configDigest,
          PLATFORM_SOURCE_REPOSITORY: build.repositoryRoot,
          PLATFORM_RELEASE_ROOT: build.releaseRoot,
          PLATFORM_BUILD_ROOT: build.buildRoot,
          PLATFORM_TOOLING_COMMIT: build.toolingCommit,
          PLATFORM_PM2_VALIDATOR: build.activationValidatorPaths[0],
          PLATFORM_NGINX_VALIDATOR: build.activationValidatorPaths[1]
        },
        timeoutMs: 120_000,
        maxOutputBytes: 65_536
      });
    }
  });

  const checks = options.loaded.manifest.checks.map((check) => ({
    id: check.id,
    kind: checkKind(check.id),
    ...(check.host ? { host: check.host } : {}),
    ...(check.port ? { port: check.port } : {}),
    path: check.path ? `/${check.path.replace(/^\//u, '')}` : '/healthz',
    protocol: check.id === 'http.smoke_public' ? ('https' as const) : ('http' as const),
    timeoutMs: check.timeoutMs ?? 10_000,
    maxBodyBytes: 16_384,
    ...(check.id === 'process.active' ? { target: 'edutrack-ops-api.service' } : {}),
    ...(check.id === 'dependency.probe' ? { target: 'http://127.0.0.1:3100/healthz' } : {}),
    ...(check.id === 'release.identity' ? { target: '/srv/edutrack/current' } : {})
  }));
  const health = createHealthCheckRunner({
    definitions: checks,
    dependencies: {
      processProbe: async (target) => {
        const result = await executor({
          executable: '/usr/bin/systemctl',
          args: ['is-active', '--quiet', target],
          env: { PATH: '/usr/bin:/bin' },
          timeoutMs: 5_000,
          maxOutputBytes: 4_096
        });
        return { active: result.exitCode === 0, stable: result.exitCode === 0 };
      },
      fetch: globalThis.fetch,
      identityProbe: async (target) => {
        let parsed: unknown;
        try {
          const marker = readFileSync(join(target, '.release-source.json'), 'utf8');
          if (Buffer.byteLength(marker, 'utf8') > 16_384) throw new Error('marker too large');
          parsed = JSON.parse(marker) as unknown;
        } catch {
          throw new Error('RELEASE_IDENTITY_UNAVAILABLE');
        }
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          typeof (parsed as Record<string, unknown>).releaseId !== 'string' ||
          typeof (parsed as Record<string, unknown>).configDigest !== 'string' ||
          !/^[0-9a-f]{40}-cfg-[0-9a-f]{64}$/u.test(
            (parsed as Record<string, unknown>).releaseId as string
          ) ||
          !/^[0-9a-f]{64}$/u.test((parsed as Record<string, unknown>).configDigest as string)
        ) {
          throw new Error('RELEASE_IDENTITY_UNAVAILABLE');
        }
        const releaseId = (parsed as Record<string, unknown>).releaseId;
        const configDigest = (parsed as Record<string, unknown>).configDigest;
        if (typeof releaseId !== 'string' || typeof configDigest !== 'string') {
          throw new Error('RELEASE_IDENTITY_UNAVAILABLE');
        }
        return { releaseId, configDigest };
      },
      dependencyProbe: async (target) => {
        try {
          const response = await globalThis.fetch(target);
          return response.ok;
        } catch {
          return false;
        }
      },
      agentProbe: async () => true,
      apiProbe: async (target) => {
        try {
          const response = await globalThis.fetch(target || 'http://127.0.0.1:3100/healthz');
          return response.ok;
        } catch {
          return false;
        }
      }
    }
  });

  function stateFor(changeId: string, appId: string): RuntimeChange {
    const existing = changes.get(changeId);
    if (existing) return existing;
    const created: RuntimeChange = { changeId, appId, state: 'DRAFT', sequence: 0, events: [] };
    changes.set(changeId, created);
    return created;
  }

  function record(input: {
    changeId: string;
    appId: string;
    state: RuntimeChange['state'];
    reasonCode: string;
    sequence?: number;
    impactPlan?: RuntimeChange['impactPlan'];
    changeDigest?: string;
  }): void {
    const current = stateFor(input.changeId, input.appId);
    const sequence = Math.max(current.sequence + 1, input.sequence ?? 0);
    const event: RuntimeEvent = {
      eventId: id('EVT'),
      changeId: input.changeId,
      sequence,
      state: input.state,
      reasonCode: input.reasonCode.toLowerCase(),
      occurredAt: new Date().toISOString()
    };
    current.state = input.state;
    current.sequence = sequence;
    if (input.impactPlan) current.impactPlan = input.impactPlan;
    if (input.changeDigest) current.changeDigest = input.changeDigest;
    current.events.push(event);
  }

  const persistEvent = async (event: ApplyEvent): Promise<void> => {
    const current = changes.get(event.changeId);
    if (!current) return;
    record({
      changeId: event.changeId,
      appId: current.appId,
      state: event.state,
      reasonCode: event.reasonCode,
      sequence: event.sequence
    });
    const records = journalRecords();
    const existing = records.find((record) => record.runId === event.runId);
    const next: RecoveryRecord = {
      changeId: event.changeId,
      runId: event.runId,
      appId: current.appId,
      state: event.state,
      hasWrites:
        existing?.hasWrites === true ||
        [
          'WRITTEN',
          'ACTION_RUNNING',
          'HEALTH_CHECKING',
          'COMPLETED',
          'ROLLING_BACK',
          'ROLLED_BACK',
          'ROLLBACK_FAILED'
        ].includes(event.state),
      sequence: event.sequence,
      ...(current.changeDigest ? { changeDigest: current.changeDigest } : {}),
      ...(buildIdentities.get(event.runId)
        ? { buildReleaseId: buildIdentities.get(event.runId)!.releaseId }
        : existing?.buildReleaseId
          ? { buildReleaseId: existing.buildReleaseId }
          : {}),
      ...(previousBuildReleases.get(event.runId)
        ? {
            previousReleaseId:
              previousBuildReleases.get(event.runId)!.releaseId ??
              previousBuildReleases.get(event.runId)!.sourceSha
          }
        : existing?.previousReleaseId
          ? { previousReleaseId: existing.previousReleaseId }
          : {})
    };
    writeJournal([...records.filter((record) => record.runId !== event.runId), next]);
    if (['COMPLETED', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(event.state)) {
      buildIdentities.delete(event.runId);
      previousBuildReleases.delete(event.runId);
    }
  };

  const coordinator = createApplyCoordinator({
    readStaged: async (changeId) => {
      const staged = await draftStore.readStaged<ValidatedChangeDraft>(changeId);
      return staged ? asStaged(staged) : null;
    },
    captureSnapshot: async ({ change }) => {
      const sources: SnapshotPayload['sources'][number][] = [];
      for (const sourceId of change.sourceIds) {
        const source = options.loaded.manifest.sources.find(
          (candidate) => candidate.id === sourceId
        );
        if (!source)
          throw Object.assign(new Error('SOURCE_NOT_FOUND'), { code: 'SOURCE_NOT_FOUND' });
        const current = await writer.readCurrent(sourceId);
        const expected = change.items.find((item) => item.sourceId === sourceId)?.sourceFingerprint;
        if (
          expected &&
          fingerprintSource(options.fingerprintKey, sourceId, current.bytes) !== expected
        ) {
          throw Object.assign(new Error('CONFIG_SOURCE_CHANGED'), {
            code: 'CONFIG_SOURCE_CHANGED'
          });
        }
        sources.push({
          sourceId,
          bytes: current.bytes,
          metadata: {
            uid: current.metadata.uid,
            gid: current.metadata.gid,
            mode: current.metadata.mode
          }
        });
      }
      return { sources };
    },
    snapshotStore,
    writeSource: (input) => writer.write(input),
    runAction: async ({ runId, actionId }) => {
      const changeId = runChanges.get(runId);
      const change = changeId ? await draftStore.readStaged<ValidatedChangeDraft>(changeId) : null;
      const definition = options.loaded.manifest.actions.find(
        (candidate) => candidate.id === actionId
      );
      let buildIdentity: BuildIdentity | undefined;
      if (definition?.id === 'release.build_redeploy' && change) {
        const buildInputs = await buildInputsFor(
          asStaged(change),
          options.loaded.catalog,
          options.loaded.manifest,
          writer
        );
        buildIdentity = buildInputs.identity;
        buildIdentities.set(runId, buildInputs.identity);
        previousBuildReleases.set(runId, currentRelease(options.loaded.manifest.build!));
        persistRunMetadata(runId);
        buildEnvironments.set(runId, buildInputs.environment);
      }
      try {
        return await actionRunner.run({
          runId,
          actionId,
          ...(buildIdentity ? { buildIdentity } : {})
        });
      } finally {
        buildEnvironments.delete(runId);
      }
    },
    rollbackAction: async ({ runId, actionId }) => {
      if (actionId !== 'release.build_redeploy') return;
      const identity = buildIdentities.get(runId);
      if (!identity) throw new Error('BUILD_IDENTITY_MISSING');
      await actionRunner.rollback({ runId, actionId, buildIdentity: identity });
    },
    runHealth: async ({ runId, checkIds }) => {
      const identity = buildIdentities.get(runId);
      const results = await health.run({
        runId,
        checkIds,
        ...(identity
          ? { expectedReleaseId: identity.releaseId, expectedConfigDigest: identity.configDigest }
          : {})
      });
      const failed = results.find((result) => result.outcome === 'failed');
      return {
        passed: !failed,
        ...(failed ? { reasonCode: failed.reasonCode } : {})
      };
    },
    rollbackHealth: async ({ runId, checkIds }) => {
      const previous = previousBuildReleases.get(runId);
      const expected = previous?.releaseId
        ? /^(?<sourceSha>[0-9a-f]{40})-cfg-(?<configDigest>[0-9a-f]{64})$/u.exec(previous.releaseId)
        : undefined;
      const results = await health.run({
        runId,
        checkIds: expected
          ? checkIds
          : checkIds.filter((checkId) => checkId !== 'release.identity'),
        ...(expected?.groups?.configDigest && previous?.releaseId
          ? {
              expectedReleaseId: previous.releaseId,
              expectedConfigDigest: expected.groups.configDigest
            }
          : {})
      });
      const failed = results.find((result) => result.outcome === 'failed');
      return {
        passed: !failed,
        ...(failed ? { reasonCode: failed.reasonCode } : {})
      };
    },
    restoreSnapshot: async ({ snapshot }) => {
      for (const source of snapshot.sources) await writer.restore(source);
    },
    persistEvent,
    acquireApplicationLock: (appId) => locks(`application:${appId}`),
    acquireSourceLock: (sourceId) => locks(`source:${sourceId}`),
    acquireActionLock: (actionId) => locks(`action:${actionId}`),
    onRollbackFailed: async ({ changeId }) => {
      const current = changes.get(changeId);
      if (current) blockedApplications.add(current.appId);
    }
  });

  const recovery = createChangeRecovery({
    readJournal: async () => journalRecords(),
    coordinator: {
      resume: async (record) => {
        if (!record.hasWrites) {
          const result = await coordinator.resume({
            changeId: record.changeId,
            runId: record.runId,
            changeDigest: record.changeDigest ?? ''
          });
          return { state: result.state };
        }
        const change = await draftStore.readStaged<ValidatedChangeDraft>(record.changeId);
        const snapshot = await snapshotStore.readSnapshot<SnapshotPayload>(`SNAP_${record.runId}`);
        if (!change || !snapshot) throw new Error('CONFIG_AGENT_RECOVERY_SNAPSHOT_MISSING');
        runChanges.set(record.runId, record.changeId);
        if (record.buildReleaseId) {
          const match = /^(?<sourceSha>[0-9a-f]{40})-cfg-(?<configDigest>[0-9a-f]{64})$/u.exec(
            record.buildReleaseId
          );
          if (match?.groups?.sourceSha && match.groups.configDigest) {
            buildIdentities.set(record.runId, {
              sourceSha: match.groups.sourceSha,
              configDigest: match.groups.configDigest,
              releaseId: record.buildReleaseId
            });
          }
        }
        if (record.previousReleaseId) {
          const match = /^(?<sourceSha>[0-9a-f]{40})(?<derived>-cfg-[0-9a-f]{64})?$/u.exec(
            record.previousReleaseId
          );
          if (match?.groups?.sourceSha) {
            previousBuildReleases.set(record.runId, {
              sourceSha: match.groups.sourceSha,
              ...(match.groups.derived ? { releaseId: record.previousReleaseId } : {})
            });
          }
        }
        try {
          await persistEvent({
            changeId: record.changeId,
            runId: record.runId,
            state: 'ROLLING_BACK',
            sequence: (record.sequence ?? 0) + 1,
            reasonCode: 'RECOVERY_ROLLBACK_STARTED'
          });
          for (const source of snapshot.sources) await writer.restore(source);
          for (const actionId of change.actionIds) {
            if (actionId === 'release.build_redeploy') {
              const identity = buildIdentities.get(record.runId);
              if (!identity) throw new Error('BUILD_IDENTITY_MISSING');
              await actionRunner.rollback({
                runId: record.runId,
                actionId,
                buildIdentity: identity
              });
            }
          }
          await persistEvent({
            changeId: record.changeId,
            runId: record.runId,
            state: 'ROLLED_BACK',
            sequence: (record.sequence ?? 0) + 2,
            reasonCode: 'RECOVERY_ROLLBACK_COMPLETED'
          });
          return { state: 'ROLLED_BACK' };
        } catch {
          await persistEvent({
            changeId: record.changeId,
            runId: record.runId,
            state: 'ROLLBACK_FAILED',
            sequence: (record.sequence ?? 0) + 2,
            reasonCode: 'RECOVERY_ROLLBACK_FAILED'
          }).catch(() => undefined);
          blockedApplications.add(change.appId);
          return { state: 'ROLLBACK_FAILED' };
        }
      }
    }
  });
  const recoveryReady = recovery.reconcile().catch(() => {
    throw Object.assign(new Error('CONFIG_AGENT_RECOVERY_FAILED'), {
      code: 'CONFIG_AGENT_RECOVERY_FAILED'
    });
  });
  const awaitRecovery = async (): Promise<void> => {
    await recoveryReady;
  };

  const handlers: AgentMutationHandlers = {
    ready: awaitRecovery,
    supportedStrategies: [
      ...new Set(options.loaded.manifest.actions.map((action) => strategyForAction(action.id)))
    ],
    validate: async (request: ChangeValidateRequest) => {
      await awaitRecovery();
      const result = await validation.validate(request);
      record({
        changeId: result.changeId,
        appId: request.appId,
        state: result.state,
        reasonCode: 'VALIDATION_READY',
        impactPlan: result.impactPlan,
        changeDigest: result.changeDigest
      });
      return result;
    },
    save: async (request: ChangeSaveRequest) => {
      await awaitRecovery();
      const draft = await draftStore.readDraft<ValidatedChangeDraft>(request.changeId);
      if (!draft || draft.changeDigest !== request.changeDigest)
        throw Object.assign(new Error('CONFIG_CHANGE_INVALID_STATE'), {
          code: 'CONFIG_CHANGE_INVALID_STATE'
        });
      await draftStore.sealDraft({ changeId: request.changeId });
      const staged = await draftStore.readStaged<ValidatedChangeDraft>(request.changeId);
      if (!staged)
        throw Object.assign(new Error('CONFIG_CHANGE_NOT_FOUND'), {
          code: 'CONFIG_CHANGE_NOT_FOUND'
        });
      record({
        changeId: request.changeId,
        appId: staged.appId,
        state: 'SAVED',
        reasonCode: 'CHANGE_SAVED',
        changeDigest: staged.changeDigest
      });
      return {
        changeId: request.changeId,
        state: 'SAVED' as const,
        changeDigest: staged.changeDigest,
        expiresAt: staged.expiresAt
      };
    },
    apply: async (request: ChangeApplyRequest) => {
      await awaitRecovery();
      const staged = await draftStore.readStaged<ValidatedChangeDraft>(request.changeId);
      if (!staged || staged.changeDigest !== request.changeDigest)
        throw Object.assign(new Error('CONFIG_CHANGE_INVALID_STATE'), {
          code: 'CONFIG_CHANGE_INVALID_STATE'
        });
      if (blockedApplications.has(staged.appId))
        throw Object.assign(new Error('CONFIG_APPLICATION_BLOCKED'), {
          code: 'CONFIG_APPLICATION_BLOCKED'
        });
      runChanges.set(request.runId, request.changeId);
      record({
        changeId: staged.changeId,
        appId: staged.appId,
        state: 'APPLYING',
        reasonCode: 'APPLY_STARTED',
        changeDigest: staged.changeDigest
      });
      void coordinator
        .apply({
          changeId: request.changeId,
          runId: request.runId,
          changeDigest: request.changeDigest
        })
        .catch(() => undefined);
      return { changeId: request.changeId, runId: request.runId, state: 'APPLYING' as const };
    },
    cancel: async (request: ChangeCancelRequest) => {
      await awaitRecovery();
      const draft = await draftStore.readDraft<ValidatedChangeDraft>(request.changeId);
      const staged = await draftStore.readStaged<ValidatedChangeDraft>(request.changeId);
      const current = draft ?? staged;
      if (!current)
        throw Object.assign(new Error('CONFIG_CHANGE_NOT_FOUND'), {
          code: 'CONFIG_CHANGE_NOT_FOUND'
        });
      if (staged) await draftStore.deleteStaged(request.changeId);
      if (draft) await draftStore.deleteDraft(request.changeId);
      record({
        changeId: request.changeId,
        appId: current.appId,
        state: 'CANCELLED',
        reasonCode: 'CHANGE_CANCELLED'
      });
      return { changeId: request.changeId, state: 'CANCELLED' as const };
    },
    status: async (request: ChangeStatusRequest) => {
      await awaitRecovery();
      const current = changes.get(request.changeId);
      if (!current)
        throw Object.assign(new Error('CONFIG_CHANGE_NOT_FOUND'), {
          code: 'CONFIG_CHANGE_NOT_FOUND'
        });
      const events = request.afterEventId
        ? current.events.slice(
            Math.max(
              0,
              current.events.findIndex((event) => event.eventId === request.afterEventId) + 1
            )
          )
        : current.events;
      return {
        changeId: request.changeId,
        state: current.state,
        sequence: current.sequence,
        events,
        ...(current.impactPlan ? { impactPlan: current.impactPlan } : {}),
        ...(current.changeDigest ? { changeDigest: current.changeDigest } : {})
      } satisfies ChangeStatusResponse;
    },
    clearApplyBlock: async (request: ClearApplyBlockRequest, actor: AgentActor) => {
      await awaitRecovery();
      if (actor.role !== 'ops_owner' || !blockedApplications.has(request.appId)) {
        throw Object.assign(new Error('CONFIG_APPLICATION_BLOCKED'), {
          code: 'CONFIG_APPLICATION_BLOCKED'
        });
      }
      blockedApplications.delete(request.appId);
      return { appId: request.appId, state: 'CLEARED' as const };
    }
  };
  return handlers;
}
