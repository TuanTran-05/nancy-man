import { describe, expect, it } from 'vitest';

import {
  createSupersedingDraft,
  createTransitionId,
  transitionChange,
  type ChangeStateSnapshot
} from './changeStateMachine.js';

const changeId = '11111111-1111-4111-8111-111111111111';
const applicationId = 'platform';
const actorUserId = '22222222-2222-4222-8222-222222222222';

function draft(overrides: Partial<ChangeStateSnapshot> = {}): ChangeStateSnapshot {
  return {
    changeId,
    applicationId,
    state: 'DRAFT',
    version: 0,
    events: [],
    ...overrides
  };
}

function transition(input: {
  snapshot: ChangeStateSnapshot;
  to: ChangeStateSnapshot['state'];
  expectedVersion: number;
  transitionId: string;
  eventId: string;
}) {
  return transitionChange({
    snapshot: input.snapshot,
    to: input.to,
    expectedVersion: input.expectedVersion,
    transitionId: createTransitionId(input.transitionId),
    eventId: createTransitionId(input.eventId),
    actorUserId,
    occurredAt: '2026-08-31T00:00:00.000Z'
  });
}

describe('config change state machine', () => {
  it('accepts the complete forward lifecycle and assigns monotonic sequences', () => {
    const states: ChangeStateSnapshot['state'][] = [
      'VALIDATING',
      'READY',
      'SAVED',
      'APPLYING',
      'SNAPSHOTTED',
      'WRITTEN',
      'ACTION_RUNNING',
      'HEALTH_CHECKING',
      'COMPLETED'
    ];
    let current = draft();
    for (const [index, state] of states.entries()) {
      current = transition({
        snapshot: current,
        to: state,
        expectedVersion: index,
        transitionId: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
        eventId: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`
      });
      expect(current.state).toBe(state);
      expect(current.version).toBe(index + 1);
      expect(current.events.at(-1)?.sequence).toBe(index + 1);
    }
    expect(current.events).toHaveLength(states.length);
  });

  it('accepts invalidation, cancellation, expiry, and automatic rollback branches', () => {
    expect(
      transition({
        snapshot: draft({ state: 'VALIDATING' }),
        to: 'INVALID',
        expectedVersion: 0,
        transitionId: '33333333-3333-4333-8333-000000000001',
        eventId: '44444444-4444-4444-8444-000000000001'
      }).state
    ).toBe('INVALID');

    for (const state of ['DRAFT', 'READY', 'SAVED'] as const) {
      expect(
        transition({
          snapshot: draft({ state }),
          to: 'CANCELLED',
          expectedVersion: 0,
          transitionId: '33333333-3333-4333-8333-000000000002',
          eventId: '44444444-4444-4444-8444-000000000002'
        }).state
      ).toBe('CANCELLED');
      expect(
        transition({
          snapshot: draft({ state }),
          to: 'EXPIRED',
          expectedVersion: 0,
          transitionId: '33333333-3333-4333-8333-000000000003',
          eventId: '44444444-4444-4444-8444-000000000003'
        }).state
      ).toBe('EXPIRED');
    }

    let applying = draft({ state: 'APPLYING', version: 4 });
    for (const state of ['SNAPSHOTTED', 'WRITTEN', 'ACTION_RUNNING', 'HEALTH_CHECKING'] as const) {
      applying = transition({
        snapshot: applying,
        to: state,
        expectedVersion: applying.version,
        transitionId: `33333333-3333-4333-8333-${String(applying.version + 1).padStart(12, '0')}`,
        eventId: `44444444-4444-4444-8444-${String(applying.version + 1).padStart(12, '0')}`
      });
    }
    const rollingBack = transition({
      snapshot: applying,
      to: 'ROLLING_BACK',
      expectedVersion: applying.version,
      transitionId: '33333333-3333-4333-8333-000000000010',
      eventId: '44444444-4444-4444-8444-000000000010'
    });
    expect(
      transition({
        snapshot: rollingBack,
        to: 'ROLLED_BACK',
        expectedVersion: rollingBack.version,
        transitionId: '33333333-3333-4333-8333-000000000011',
        eventId: '44444444-4444-4444-8444-000000000011'
      }).state
    ).toBe('ROLLED_BACK');
    expect(
      transition({
        snapshot: rollingBack,
        to: 'ROLLBACK_FAILED',
        expectedVersion: rollingBack.version,
        transitionId: '33333333-3333-4333-8333-000000000012',
        eventId: '44444444-4444-4444-8444-000000000012'
      }).state
    ).toBe('ROLLBACK_FAILED');
  });

  it('rejects terminal transitions, stale versions, and a second APPLYING start', () => {
    expect(() =>
      transition({
        snapshot: draft({ state: 'INVALID' }),
        to: 'DRAFT',
        expectedVersion: 0,
        transitionId: '33333333-3333-4333-8333-000000000020',
        eventId: '44444444-4444-4444-8444-000000000020'
      })
    ).toThrow('CHANGE_TRANSITION_TERMINAL');

    expect(() =>
      transition({
        snapshot: draft(),
        to: 'VALIDATING',
        expectedVersion: 4,
        transitionId: '33333333-3333-4333-8333-000000000021',
        eventId: '44444444-4444-4444-8444-000000000021'
      })
    ).toThrow('CHANGE_VERSION_CONFLICT');

    const firstApply = transition({
      snapshot: draft({ state: 'SAVED' }),
      to: 'APPLYING',
      expectedVersion: 0,
      transitionId: '33333333-3333-4333-8333-000000000022',
      eventId: '44444444-4444-4444-8444-000000000022'
    });
    expect(() =>
      transition({
        snapshot: firstApply,
        to: 'APPLYING',
        expectedVersion: firstApply.version,
        transitionId: '33333333-3333-4333-8333-000000000023',
        eventId: '44444444-4444-4444-8444-000000000023'
      })
    ).toThrow('CHANGE_TRANSITION_ILLEGAL');

    expect(() =>
      transition({
        snapshot: draft({ state: 'VALIDATING' }),
        to: 'ROLLING_BACK',
        expectedVersion: 0,
        transitionId: '33333333-3333-4333-8333-000000000024',
        eventId: '44444444-4444-4444-8444-000000000024'
      })
    ).toThrow('CHANGE_TRANSITION_ILLEGAL');
  });

  it('replays the same transition or event id without incrementing the version', () => {
    const first = transition({
      snapshot: draft(),
      to: 'VALIDATING',
      expectedVersion: 0,
      transitionId: '33333333-3333-4333-8333-000000000030',
      eventId: '44444444-4444-4444-8444-000000000030'
    });
    expect(
      transition({
        snapshot: first,
        to: 'VALIDATING',
        expectedVersion: 0,
        transitionId: '33333333-3333-4333-8333-000000000030',
        eventId: '44444444-4444-4444-8444-000000000030'
      })
    ).toEqual(first);
    expect(
      transition({
        snapshot: first,
        to: 'VALIDATING',
        expectedVersion: 0,
        transitionId: '33333333-3333-4333-8333-000000000031',
        eventId: '44444444-4444-4444-8444-000000000030'
      })
    ).toEqual(first);
    expect(() =>
      transition({
        snapshot: first,
        to: 'READY',
        expectedVersion: 0,
        transitionId: '33333333-3333-4333-8333-000000000030',
        eventId: '44444444-4444-4444-8444-000000000032'
      })
    ).toThrow('CHANGE_IDEMPOTENCY_CONFLICT');
  });

  it('creates a same-application superseding draft for invalid or validated changes', () => {
    const replacement = createSupersedingDraft({
      changeId: '55555555-5555-4555-8555-555555555555',
      applicationId,
      source: {
        changeId,
        applicationId,
        state: 'INVALID',
        version: 2,
        events: []
      },
      actorUserId
    });
    expect(replacement).toMatchObject({
      changeId: '55555555-5555-4555-8555-555555555555',
      applicationId,
      state: 'DRAFT',
      version: 0,
      supersedesChangeId: changeId,
      actorUserId
    });

    expect(() =>
      createSupersedingDraft({
        changeId: '66666666-6666-4666-8666-666666666666',
        applicationId,
        source: { ...replacement, applicationId: 'other-app' },
        actorUserId
      })
    ).toThrow('CHANGE_SUPERSEDES_APPLICATION_MISMATCH');
    expect(() =>
      createSupersedingDraft({
        changeId: '77777777-7777-4777-8777-777777777777',
        applicationId,
        source: { ...replacement, state: 'APPLYING' },
        actorUserId
      })
    ).toThrow('CHANGE_SUPERSEDES_STATE_INVALID');
    expect(() =>
      createSupersedingDraft({
        changeId: replacement.changeId,
        applicationId,
        source: replacement,
        actorUserId
      })
    ).toThrow('CHANGE_SUPERSEDES_SELF');
  });
});
