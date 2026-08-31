import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
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
  snapshotKey: ConstructorParameters<typeof SnapshotStore>[0]['snapshotKey'];
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

function currentSourceSha(releaseRoot?: string): string {
  const current =
    process.env.OPS_PLATFORM_CURRENT_RELEASE ?? join(releaseRoot ?? '/srv/edutrack', 'current');
  let releaseName: string;
  try {
    releaseName = basename(readlinkSync(current));
  } catch {
    throw Object.assign(new Error('BUILD_SOURCE_UNAVAILABLE'), {
      code: 'BUILD_SOURCE_UNAVAILABLE'
    });
  }
  const sourceSha = releaseName.slice(0, 40);
  if (!/^[0-9a-f]{40}$/u.test(sourceSha)) {
    throw Object.assign(new Error('BUILD_SOURCE_INVALID'), { code: 'BUILD_SOURCE_INVALID' });
  }
  return sourceSha;
}

function lockFactory() {
  const tails = new Map<string, Promise<void>>();
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
    return () => release();
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
  const sourceSha = currentSourceSha(build.releaseRoot);
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
    draftTtlMs: options.config.draftTtlMs,
    stagedTtlMs: options.config.stagedTtlMs
  });
  const snapshotStore = new SnapshotStore({
    ...storage,
    snapshotKey: options.snapshotKey,
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
  const locks = lockFactory();
  const changes = new Map<string, RuntimeChange>();
  const runChanges = new Map<string, string>();
  const buildEnvironments = new Map<string, Readonly<Record<string, string>>>();
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
        ...(value.changeDigest ? { changeDigest: value.changeDigest } : {})
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
          const staging = mkdtempSync(join(stagingRoot, `config-${runId}-`));
          try {
            const environmentPath = join(staging, 'public-build.env');
            const environment = buildEnvironments.get(runId);
            if (!environment)
              throw Object.assign(new Error('BUILD_ENVIRONMENT_MISSING'), {
                code: 'BUILD_ENVIRONMENT_MISSING'
              });
            writeFileSync(
              environmentPath,
              `${Object.entries(environment)
                .map(([name, value]) => `${name}=${value}`)
                .join('\n')}\n`,
              { mode: 0o600, flag: 'wx' }
            );
            return executor({
              executable: '/usr/bin/bash',
              args: [
                releaseScript,
                '--source-sha',
                identity.sourceSha,
                '--release-id',
                identity.releaseId,
                '--config-digest',
                identity.configDigest,
                '--staging',
                staging
              ],
              cwd: build.releaseRoot,
              env: {
                PATH: '/usr/bin:/bin',
                NODE_ENV: 'production',
                APP_COMMIT_SHA: identity.sourceSha,
                APP_RELEASE_ID: identity.releaseId,
                APP_CONFIG_DIGEST: identity.configDigest,
                PLATFORM_SOURCE_REPOSITORY: build.repositoryRoot,
                PLATFORM_RELEASE_ROOT: build.releaseRoot,
                PLATFORM_BUILD_ROOT: build.buildRoot
              },
              timeoutMs: 300_000,
              maxOutputBytes: 65_536
            });
          } finally {
            rmSync(staging, { recursive: true, force: true });
          }
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
    ...(check.id === 'release.identity'
      ? { target: process.env.OPS_PLATFORM_CURRENT_RELEASE ?? '/srv/edutrack/current' }
      : {})
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
      identityProbe: async () => {
        throw new Error('RELEASE_IDENTITY_UNAVAILABLE');
      },
      dependencyProbe: async () => false,
      agentProbe: async () => true,
      apiProbe: async () => false
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
      ...(current.changeDigest ? { changeDigest: current.changeDigest } : {})
    };
    writeJournal([...records.filter((record) => record.runId !== event.runId), next]);
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
    runHealth: async ({ runId, checkIds }) => {
      const results = await health.run({ runId, checkIds });
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
        const result = await coordinator.resume({
          changeId: record.changeId,
          runId: record.runId,
          changeDigest: record.changeDigest ?? ''
        });
        return { state: result.state };
      }
    }
  });
  void recovery.reconcile().catch(() => undefined);

  const handlers: AgentMutationHandlers = {
    supportedStrategies: [
      ...new Set(options.loaded.manifest.actions.map((action) => strategyForAction(action.id)))
    ],
    validate: async (request: ChangeValidateRequest) => {
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
