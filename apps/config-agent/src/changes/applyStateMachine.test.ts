import { describe, expect, test } from 'vitest';

import {
  createApplyStateMachine,
  ApplyStateMachineError,
  type ApplyState
} from './applyStateMachine.js';

describe('config-agent apply state machine', () => {
  test('accepts only monotonic apply and rollback transitions', () => {
    const machine = createApplyStateMachine('APPLYING');
    const transitions: Array<[ApplyState, string]> = [
      ['SNAPSHOTTED', 'snapshot'],
      ['WRITTEN', 'write'],
      ['ACTION_RUNNING', 'action'],
      ['HEALTH_CHECKING', 'health'],
      ['COMPLETED', 'complete']
    ];
    for (const [state, eventId] of transitions) {
      expect(machine.transition(state, eventId)).toBe(state);
    }
    expect(() => machine.transition('ROLLING_BACK', 'late-rollback')).toThrowError(
      expect.objectContaining({ code: 'APPLY_STATE_TERMINAL' })
    );
  });

  test('replays event IDs idempotently and rejects a second active run for an application', () => {
    const machine = createApplyStateMachine('APPLYING');
    expect(machine.transition('SNAPSHOTTED', 'same-event')).toBe('SNAPSHOTTED');
    expect(machine.transition('SNAPSHOTTED', 'same-event')).toBe('SNAPSHOTTED');
    expect(machine.sequence).toBe(1);
    expect(() => machine.transition('WRITTEN', 'different-event')).not.toThrow();

    const lock = createApplyStateMachine('APPLYING', { applicationId: 'edutrack' });
    expect(() => lock.assertApplicationAvailable('edutrack')).toThrowError(
      expect.objectContaining({ code: 'APPLY_ALREADY_RUNNING' })
    );
  });

  test('rollback succeeds or ends in an explicit terminal failure', () => {
    const machine = createApplyStateMachine('HEALTH_CHECKING');
    machine.transition('ROLLING_BACK', 'rollback-start');
    expect(machine.transition('ROLLED_BACK', 'rollback-complete')).toBe('ROLLED_BACK');
    expect(() => machine.transition('COMPLETED', 'invalid')).toThrowError(ApplyStateMachineError);
  });
});
