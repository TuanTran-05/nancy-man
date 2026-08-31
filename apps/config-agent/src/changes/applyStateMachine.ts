export type ApplyState =
  | 'APPLYING'
  | 'SNAPSHOTTED'
  | 'WRITTEN'
  | 'ACTION_RUNNING'
  | 'HEALTH_CHECKING'
  | 'COMPLETED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED';

export type ApplyStateMachineErrorCode =
  | 'APPLY_STATE_INVALID'
  | 'APPLY_STATE_TERMINAL'
  | 'APPLY_TRANSITION_INVALID'
  | 'APPLY_EVENT_REPLAY_CONFLICT'
  | 'APPLY_ALREADY_RUNNING';

export class ApplyStateMachineError extends Error {
  readonly code: ApplyStateMachineErrorCode;

  constructor(code: ApplyStateMachineErrorCode) {
    super(code);
    this.name = 'ApplyStateMachineError';
    this.code = code;
  }
}

function fail(code: ApplyStateMachineErrorCode): never {
  throw new ApplyStateMachineError(code);
}

const transitions: Readonly<Record<ApplyState, readonly ApplyState[]>> = {
  APPLYING: ['SNAPSHOTTED', 'ROLLING_BACK'],
  SNAPSHOTTED: ['WRITTEN', 'ROLLING_BACK'],
  WRITTEN: ['ACTION_RUNNING', 'ROLLING_BACK'],
  ACTION_RUNNING: ['HEALTH_CHECKING', 'ROLLING_BACK'],
  HEALTH_CHECKING: ['COMPLETED', 'ROLLING_BACK'],
  COMPLETED: [],
  ROLLING_BACK: ['ROLLED_BACK', 'ROLLBACK_FAILED'],
  ROLLED_BACK: [],
  ROLLBACK_FAILED: []
};

const terminal = new Set<ApplyState>(['COMPLETED', 'ROLLED_BACK', 'ROLLBACK_FAILED']);

export function createApplyStateMachine(
  initialState: ApplyState,
  options: Readonly<{ applicationId?: string }> = {}
) {
  if (!transitions[initialState]) fail('APPLY_STATE_INVALID');
  let current = initialState;
  let sequence = 0;
  const eventStates = new Map<string, ApplyState>();

  function transition(next: ApplyState, eventId: string): ApplyState {
    if (!eventId || !transitions[next]) fail('APPLY_STATE_INVALID');
    const replayed = eventStates.get(eventId);
    if (replayed) {
      if (replayed !== next) fail('APPLY_EVENT_REPLAY_CONFLICT');
      return current;
    }
    if (terminal.has(current)) fail('APPLY_STATE_TERMINAL');
    if (!transitions[current].includes(next)) fail('APPLY_TRANSITION_INVALID');
    current = next;
    sequence += 1;
    eventStates.set(eventId, next);
    return current;
  }

  function assertApplicationAvailable(applicationId: string): void {
    if (
      options.applicationId &&
      options.applicationId === applicationId &&
      !terminal.has(current)
    ) {
      fail('APPLY_ALREADY_RUNNING');
    }
  }

  return {
    get state(): ApplyState {
      return current;
    },
    get sequence(): number {
      return sequence;
    },
    transition,
    assertApplicationAvailable
  };
}
