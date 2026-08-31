import type { ApplyState } from './applyStateMachine.js';
import type { ApplyCoordinatorResult } from './applyCoordinator.js';

export type RecoveryRecord = Readonly<{
  changeId: string;
  runId: string;
  appId: string;
  state: ApplyState;
  hasWrites: boolean;
  changeDigest?: string;
}>;

export type RecoveryCoordinator = Readonly<{
  resume: (record: RecoveryRecord) => Promise<Pick<ApplyCoordinatorResult, 'state'>>;
}>;

export type ChangeRecoveryOptions = Readonly<{
  readJournal: () => Promise<readonly RecoveryRecord[]>;
  coordinator: RecoveryCoordinator;
  readAgentState?: (record: RecoveryRecord) => Promise<Readonly<{ state: ApplyState; runId: string }> | null>;
  readFixedSystemState?: (record: RecoveryRecord) => Promise<Readonly<{ runId: string }> | null>;
}>;

export type RecoveryResult = Readonly<{
  changeId: string;
  runId: string;
  state: ApplyState;
}>;

const terminal = new Set<ApplyState>(['COMPLETED', 'ROLLED_BACK', 'ROLLBACK_FAILED']);

export function createChangeRecovery(options: ChangeRecoveryOptions) {
  let reconciliation: Promise<RecoveryResult[]> | undefined;

  async function reconcile(): Promise<RecoveryResult[]> {
    if (reconciliation) return reconciliation;
    reconciliation = (async () => {
      const journal = await options.readJournal();
      const unique = new Map<string, RecoveryRecord>();
      for (const record of journal) {
        if (!terminal.has(record.state) && !unique.has(record.runId)) unique.set(record.runId, record);
      }
      const recovered: RecoveryResult[] = [];
      for (const record of unique.values()) {
        const agentState = options.readAgentState ? await options.readAgentState(record) : null;
        const fixedState = options.readFixedSystemState ? await options.readFixedSystemState(record) : null;
        // State observations are evidence for the same run only; browser/API data never chooses a new run.
        if (agentState && agentState.runId !== record.runId) continue;
        if (fixedState && fixedState.runId !== record.runId) continue;
        const resumed = await options.coordinator.resume(record);
        recovered.push({ changeId: record.changeId, runId: record.runId, state: resumed.state });
      }
      return recovered;
    })();
    try {
      return await reconciliation;
    } finally {
      reconciliation = undefined;
    }
  }

  return { reconcile };
}
