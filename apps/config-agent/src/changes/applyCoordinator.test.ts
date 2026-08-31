import { describe, expect, test } from 'vitest';

import {
  createApplyCoordinator,
  ApplyCoordinatorError,
  type ApplyCoordinatorDependencies,
  type StagedChangePayload
} from './applyCoordinator.js';

const staged: StagedChangePayload = {
  changeId: 'CHG_APPLY_1',
  appId: 'edutrack',
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-08-31',
  changeDigest: `hmac-sha256:v1:${'a'.repeat(64)}`,
  expiresAt: '2026-08-31T14:00:00.000Z',
  sourceIds: ['edutrack.shared_env'],
  actionIds: ['pm2.reload_app'],
  checkIds: ['process.active'],
  items: [
    {
      sourceId: 'edutrack.shared_env',
      name: 'PORT',
      duplicateOrdinal: 0,
      operation: 'set',
      requirement: 'required',
      value: '3001',
      sourceFingerprint: `hmac-sha256:v1:${'b'.repeat(64)}`
    }
  ]
};

function dependencies(overrides: Partial<ApplyCoordinatorDependencies> = {}) {
  const calls: string[] = [];
  const deps: ApplyCoordinatorDependencies = {
    now: () => new Date('2026-08-31T13:10:00.000Z'),
    readStaged: async () => staged,
    captureSnapshot: async () => {
      calls.push('snapshot');
      return { sources: [{ sourceId: 'edutrack.shared_env', bytes: Buffer.from('PORT=3000\n'), metadata: { mode: 0o640, uid: 1, gid: 1 } }] };
    },
    persistSnapshot: async () => undefined,
    writeSource: async () => calls.push('write'),
    runAction: async () => calls.push('action'),
    runHealth: async () => ({ passed: true }),
    restoreSnapshot: async () => calls.push('restore'),
    persistEvent: async (event) => calls.push(event.state),
    onRollbackFailed: async () => calls.push('blocked'),
    ...overrides
  };
  return { deps, calls };
}

describe('config-agent apply coordinator', () => {
  test('verifies, snapshots, writes, actions, health, and completes in order', async () => {
    const { deps, calls } = dependencies();
    const coordinator = createApplyCoordinator(deps);

    const result = await coordinator.apply({
      changeId: staged.changeId,
      runId: 'RUN_APPLY_1',
      changeDigest: staged.changeDigest
    });

    expect(result).toMatchObject({ state: 'COMPLETED', outcome: 'completed' });
    expect(calls).toEqual([
      'APPLYING',
      'snapshot',
      'SNAPSHOTTED',
      'write',
      'WRITTEN',
      'ACTION_RUNNING',
      'action',
      'HEALTH_CHECKING',
      'COMPLETED'
    ]);
  });

  test('rolls back after a post-write failure and reports rollback failure without values', async () => {
    const { deps, calls } = dependencies({
      runHealth: async () => ({ passed: false, reasonCode: 'READINESS_FAILED' })
    });
    const coordinator = createApplyCoordinator(deps);

    await expect(
      coordinator.apply({ changeId: staged.changeId, runId: 'RUN_APPLY_2', changeDigest: staged.changeDigest })
    ).resolves.toMatchObject({ state: 'ROLLED_BACK', outcome: 'rolled_back' });
    expect(calls).toContain('restore');

    const failed = dependencies({
      runHealth: async () => ({ passed: false, reasonCode: 'READINESS_FAILED' }),
      restoreSnapshot: async () => {
        throw new Error('restore failed');
      }
    });
    await expect(
      createApplyCoordinator(failed.deps).apply({
        changeId: staged.changeId,
        runId: 'RUN_APPLY_3',
        changeDigest: staged.changeDigest
      })
    ).resolves.toMatchObject({ state: 'ROLLBACK_FAILED', outcome: 'rollback_failed' });
    expect(failed.calls).toContain('blocked');
    expect(JSON.stringify(failed.calls)).not.toContain('3001');
  });

  test('precondition failure occurs before snapshot and never claims rollback', async () => {
    const { deps, calls } = dependencies({
      captureSnapshot: async () => {
        throw new ApplyCoordinatorError('CONFIG_SOURCE_CHANGED');
      }
    });
    await expect(
      createApplyCoordinator(deps).apply({
        changeId: staged.changeId,
        runId: 'RUN_APPLY_4',
        changeDigest: staged.changeDigest
      })
    ).rejects.toMatchObject({ code: 'CONFIG_SOURCE_CHANGED', rolledBack: false });
    expect(calls).not.toContain('restore');
    expect(calls).not.toContain('ROLLING_BACK');
  });
});
