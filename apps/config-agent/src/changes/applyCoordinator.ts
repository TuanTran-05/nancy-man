import type { SnapshotStore } from './snapshotStore.js';
import {
  createApplyStateMachine,
  type ApplyState
} from './applyStateMachine.js';
import type { AtomicWriteOperation } from './atomicSourceWriter.js';

export type StagedChangeItem = Readonly<{
  sourceId: string;
  name: string;
  duplicateOrdinal: number;
  operation: 'set' | 'delete';
  requirement: 'required' | 'optional';
  value?: string;
  sourceFingerprint: string;
}>;

export type StagedChangePayload = Readonly<{
  changeId: string;
  appId: string;
  catalogVersion: string;
  manifestVersion: string;
  changeDigest: string;
  expiresAt: string;
  sourceIds: readonly string[];
  actionIds: readonly string[];
  checkIds: readonly string[];
  items: readonly StagedChangeItem[];
}>;

export type SnapshotPayload = Readonly<{
  sources: readonly Readonly<{
    sourceId: string;
    bytes: Buffer;
    metadata: Readonly<{ uid: number; gid: number; mode: number }>;
  }>[];
}>;

export type ApplyEvent = Readonly<{
  changeId: string;
  runId: string;
  state: ApplyState;
  sequence: number;
  reasonCode: string;
}>;

export type ApplyCoordinatorDependencies = Readonly<{
  now?: () => Date;
  readStaged: (changeId: string) => Promise<StagedChangePayload | null>;
  captureSnapshot: (input: Readonly<{ change: StagedChangePayload; runId: string }>) => Promise<SnapshotPayload>;
  persistSnapshot?: (input: Readonly<{ snapshotId: string; change: StagedChangePayload; snapshot: SnapshotPayload }>) => Promise<void>;
  snapshotStore?: Pick<SnapshotStore, 'createSnapshot' | 'markRollbackFailed'>;
  acquireApplicationLock?: (applicationId: string) => Promise<() => Promise<void> | void>;
  acquireSourceLock?: (sourceId: string) => Promise<() => Promise<void> | void>;
  acquireActionLock?: (actionId: string) => Promise<() => Promise<void> | void>;
  writeSource: (input: Readonly<{
    sourceId: string;
    expectedSourceFingerprint: string;
    operations: readonly AtomicWriteOperation[];
  }>) => Promise<unknown>;
  runAction: (input: Readonly<{ runId: string; actionId: string }>) => Promise<unknown>;
  rollbackAction?: (input: Readonly<{ runId: string; actionId: string }>) => Promise<unknown>;
  runHealth: (input: Readonly<{ runId: string; checkIds: readonly string[]; rollback: boolean }>) => Promise<Readonly<{ passed: boolean; reasonCode?: string }>>;
  restoreSnapshot: (input: Readonly<{ change: StagedChangePayload; runId: string; snapshot: SnapshotPayload }>) => Promise<void>;
  rollbackHealth?: (input: Readonly<{ runId: string; checkIds: readonly string[] }>) => Promise<Readonly<{ passed: boolean; reasonCode?: string }>>;
  persistEvent: (event: ApplyEvent) => Promise<void>;
  onRollbackFailed?: (input: Readonly<{ changeId: string; runId: string; snapshotId: string; reasonCode: string }>) => Promise<void>;
}>;

export type ApplyCoordinatorResult = Readonly<{
  changeId: string;
  runId: string;
  state: ApplyState;
  outcome: 'completed' | 'rolled_back' | 'rollback_failed';
}>;

export type ApplyCoordinatorErrorCode =
  | 'STAGED_CHANGE_NOT_FOUND'
  | 'CHANGE_DIGEST_MISMATCH'
  | 'STAGED_CHANGE_EXPIRED'
  | 'APPLY_ALREADY_RUNNING'
  | 'APPLY_PRECONDITION_FAILED'
  | 'CONFIG_SOURCE_CHANGED'
  | 'APPLY_FAILED';

export class ApplyCoordinatorError extends Error {
  readonly code: ApplyCoordinatorErrorCode;
  readonly rolledBack: boolean;

  constructor(code: ApplyCoordinatorErrorCode, rolledBack = false) {
    super(code);
    this.name = 'ApplyCoordinatorError';
    this.code = code;
    this.rolledBack = rolledBack;
  }
}

function errorCode(error: unknown): ApplyCoordinatorErrorCode {
  if (error instanceof ApplyCoordinatorError) return error.code;
  if (error instanceof Error && 'code' in error && error.code === 'CONFIG_SOURCE_CHANGED') {
    return 'CONFIG_SOURCE_CHANGED';
  }
  return 'APPLY_FAILED';
}

function sourceOperations(change: StagedChangePayload): Array<{
  sourceId: string;
  expectedSourceFingerprint: string;
  operations: AtomicWriteOperation[];
}> {
  const groups = new Map<string, { expectedSourceFingerprint: string; operations: AtomicWriteOperation[] }>();
  for (const item of change.items) {
    const group = groups.get(item.sourceId) ?? { expectedSourceFingerprint: item.sourceFingerprint, operations: [] };
    if (group.expectedSourceFingerprint !== item.sourceFingerprint) throw new ApplyCoordinatorError('CONFIG_SOURCE_CHANGED');
    group.operations.push({
      name: item.name,
      duplicateOrdinal: item.duplicateOrdinal,
      operation: item.operation,
      requirement: item.requirement,
      ...(item.value === undefined ? {} : { value: item.value })
    });
    groups.set(item.sourceId, group);
  }
  return [...groups.entries()].map(([sourceId, group]) => ({ sourceId, ...group }));
}

export function createApplyCoordinator(dependencies: ApplyCoordinatorDependencies) {
  const activeApplications = new Set<string>();
  const runs = new Map<string, Promise<ApplyCoordinatorResult>>();
  const results = new Map<string, ApplyCoordinatorResult>();
  const now = dependencies.now ?? (() => new Date());

  async function emit(
    machine: ReturnType<typeof createApplyStateMachine>,
    changeId: string,
    runId: string,
    state: ApplyState,
    reasonCode: string
  ): Promise<void> {
    machine.transition(state, `${runId}:${state}:${machine.sequence + 1}`);
    await dependencies.persistEvent({ changeId, runId, state, sequence: machine.sequence, reasonCode });
  }

  async function apply(input: Readonly<{ changeId: string; runId: string; changeDigest: string }>): Promise<ApplyCoordinatorResult> {
    const prior = results.get(input.runId);
    if (prior) return prior;
    const running = runs.get(input.runId);
    if (running) return running;
    const operation = performApply(input);
    runs.set(input.runId, operation);
    try {
      const completed = await operation;
      results.set(input.runId, completed);
      return completed;
    } finally {
      runs.delete(input.runId);
    }
  }

  async function performApply(input: Readonly<{ changeId: string; runId: string; changeDigest: string }>): Promise<ApplyCoordinatorResult> {
    let snapshot: SnapshotPayload | undefined;
    let snapshotId = `SNAP_${input.runId}`;
    let writeStarted = false;
    let machine: ReturnType<typeof createApplyStateMachine> | undefined;
    let change: StagedChangePayload | null = null;
    const releases: Array<() => Promise<void> | void> = [];
    try {
      change = await dependencies.readStaged(input.changeId);
      if (!change) throw new ApplyCoordinatorError('STAGED_CHANGE_NOT_FOUND');
      if (change.changeDigest !== input.changeDigest) throw new ApplyCoordinatorError('CHANGE_DIGEST_MISMATCH');
      if (Date.parse(change.expiresAt) <= now().getTime()) throw new ApplyCoordinatorError('STAGED_CHANGE_EXPIRED');
      if (activeApplications.has(change.appId)) throw new ApplyCoordinatorError('APPLY_ALREADY_RUNNING');
      activeApplications.add(change.appId);
      if (dependencies.acquireApplicationLock) releases.push(await dependencies.acquireApplicationLock(change.appId));
      machine = createApplyStateMachine('APPLYING', { applicationId: change.appId });
      await dependencies.persistEvent({ changeId: change.changeId, runId: input.runId, state: 'APPLYING', sequence: 0, reasonCode: 'APPLY_STARTED' });
      // Snapshot capture is the last pre-write boundary. No rollback is claimed before it succeeds.
      if (dependencies.acquireSourceLock) {
        for (const sourceId of change.sourceIds) releases.push(await dependencies.acquireSourceLock(sourceId));
      }
      if (dependencies.acquireActionLock) {
        for (const actionId of change.actionIds) releases.push(await dependencies.acquireActionLock(actionId));
      }
      snapshot = await dependencies.captureSnapshot({ change, runId: input.runId });
      if (dependencies.persistSnapshot) await dependencies.persistSnapshot({ snapshotId, change, snapshot });
      else if (dependencies.snapshotStore) {
        await dependencies.snapshotStore.createSnapshot({
          snapshotId,
          changeId: change.changeId,
          appId: change.appId,
          catalogVersion: change.catalogVersion,
          manifestVersion: change.manifestVersion,
          value: snapshot
        });
      }
      await emit(machine, change.changeId, input.runId, 'SNAPSHOTTED', 'SNAPSHOT_RECORDED');
      for (const source of sourceOperations(change)) {
        writeStarted = true;
        await dependencies.writeSource(source);
      }
      await emit(machine, change.changeId, input.runId, 'WRITTEN', 'SOURCES_WRITTEN');
      await emit(machine, change.changeId, input.runId, 'ACTION_RUNNING', 'ACTIONS_STARTED');
      for (const actionId of change.actionIds) await dependencies.runAction({ runId: input.runId, actionId });
      await emit(machine, change.changeId, input.runId, 'HEALTH_CHECKING', 'HEALTH_CHECKS_STARTED');
      const health = await dependencies.runHealth({ runId: input.runId, checkIds: change.checkIds, rollback: false });
      if (!health.passed) throw new ApplyCoordinatorError('APPLY_FAILED');
      await emit(machine, change.changeId, input.runId, 'COMPLETED', 'HEALTH_CHECKS_PASSED');
      return { changeId: change.changeId, runId: input.runId, state: 'COMPLETED', outcome: 'completed' };
    } catch (error) {
      const code = errorCode(error);
      if (!change || !snapshot || !writeStarted || !machine) {
        throw error instanceof ApplyCoordinatorError ? error : new ApplyCoordinatorError(code === 'CONFIG_SOURCE_CHANGED' ? code : 'APPLY_PRECONDITION_FAILED', false);
      }
      try {
        await emit(machine, change.changeId, input.runId, 'ROLLING_BACK', 'ROLLBACK_STARTED');
        await dependencies.restoreSnapshot({ change, runId: input.runId, snapshot });
        for (const actionId of change.actionIds) {
          if (dependencies.rollbackAction) await dependencies.rollbackAction({ runId: input.runId, actionId });
        }
        const rollbackHealth = dependencies.rollbackHealth
          ? await dependencies.rollbackHealth({ runId: input.runId, checkIds: change.checkIds })
          : { passed: true };
        if (!rollbackHealth.passed) throw new Error('rollback health failed');
        await emit(machine, change.changeId, input.runId, 'ROLLED_BACK', 'ROLLBACK_HEALTH_PASSED');
        return { changeId: change.changeId, runId: input.runId, state: 'ROLLED_BACK', outcome: 'rolled_back' };
      } catch {
        try {
          await dependencies.snapshotStore?.markRollbackFailed(snapshotId);
        } catch {
          // Evidence retention is best effort; the failure callback remains mandatory.
        }
        try {
          await emit(machine, change.changeId, input.runId, 'ROLLBACK_FAILED', 'ROLLBACK_FAILED');
        } catch {
          // A failed journal write must not leak the original error or any value-bearing context.
        }
        await dependencies.onRollbackFailed?.({ changeId: change.changeId, runId: input.runId, snapshotId, reasonCode: 'ROLLBACK_FAILED' });
        return { changeId: change.changeId, runId: input.runId, state: 'ROLLBACK_FAILED', outcome: 'rollback_failed' };
      }
    } finally {
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch {
          // Lock release is best effort after the value-free journal has been closed.
        }
      }
      if (change) activeApplications.delete(change.appId);
    }
  }

  async function resume(input: Readonly<{ changeId: string; runId: string; changeDigest: string }>): Promise<ApplyCoordinatorResult> {
    return apply(input);
  }

  return { apply, resume };
}
