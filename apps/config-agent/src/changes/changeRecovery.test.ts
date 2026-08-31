import { describe, expect, test } from 'vitest';

import { createChangeRecovery, type RecoveryCoordinator } from './changeRecovery.js';

describe('config-agent apply restart recovery', () => {
  test('resumes the same non-terminal run exactly once and never starts a second apply', async () => {
    const calls: string[] = [];
    const coordinator: RecoveryCoordinator = {
      resume: async (record) => {
        calls.push(`${record.changeId}:${record.runId}`);
        return { state: 'COMPLETED' };
      }
    };
    const recovery = createChangeRecovery({
      readJournal: async () => [
        { changeId: 'CHG_RECOVERY_1', runId: 'RUN_RECOVERY_1', appId: 'edutrack', state: 'WRITTEN', hasWrites: true },
        { changeId: 'CHG_RECOVERY_1', runId: 'RUN_RECOVERY_1', appId: 'edutrack', state: 'WRITTEN', hasWrites: true }
      ],
      coordinator
    });

    const result = await recovery.reconcile();

    expect(calls).toEqual(['CHG_RECOVERY_1:RUN_RECOVERY_1']);
    expect(result).toEqual([{ changeId: 'CHG_RECOVERY_1', runId: 'RUN_RECOVERY_1', state: 'COMPLETED' }]);
  });

  test('asks the coordinator to enter rollback for a journal that crossed the write boundary', async () => {
    let recordState: string | undefined;
    const recovery = createChangeRecovery({
      readJournal: async () => [
        { changeId: 'CHG_RECOVERY_2', runId: 'RUN_RECOVERY_2', appId: 'edutrack', state: 'ACTION_RUNNING', hasWrites: true }
      ],
      coordinator: {
        resume: async (record) => {
          recordState = record.state;
          return { state: 'ROLLED_BACK' };
        }
      }
    });

    await expect(recovery.reconcile()).resolves.toEqual([
      { changeId: 'CHG_RECOVERY_2', runId: 'RUN_RECOVERY_2', state: 'ROLLED_BACK' }
    ]);
    expect(recordState).toBe('ACTION_RUNNING');
  });
});
