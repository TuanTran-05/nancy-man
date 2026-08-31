export const CHANGE_STATES = [
  'DRAFT',
  'VALIDATING',
  'INVALID',
  'READY',
  'SAVED',
  'APPLYING',
  'SNAPSHOTTED',
  'WRITTEN',
  'ACTION_RUNNING',
  'HEALTH_CHECKING',
  'COMPLETED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
  'CANCELLED',
  'EXPIRED'
] as const;

export type ChangeState = (typeof CHANGE_STATES)[number];

export const TERMINAL_CHANGE_STATES: ReadonlySet<ChangeState> = new Set([
  'INVALID',
  'COMPLETED',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
  'EXPIRED',
  'CANCELLED'
]);

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type TransitionId = BrandedId<'ConfigTransitionId'>;
export type EventId = TransitionId;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createTransitionId(value: string): TransitionId {
  if (!uuidPattern.test(value)) throw new Error('CHANGE_TRANSITION_ID_INVALID');
  return value as TransitionId;
}

export type ChangeTransitionEvent = {
  transitionId: TransitionId;
  eventId: EventId;
  from: ChangeState;
  to: ChangeState;
  sequence: number;
  actorUserId: string;
  occurredAt: string;
};

export type ChangeStateSnapshot = {
  changeId: string;
  applicationId: string;
  state: ChangeState;
  version: number;
  events: readonly ChangeTransitionEvent[];
  supersedesChangeId?: string;
  actorUserId?: string;
};

const legalTransitions: Readonly<Record<ChangeState, readonly ChangeState[]>> = {
  DRAFT: ['VALIDATING', 'CANCELLED', 'EXPIRED'],
  VALIDATING: ['INVALID', 'READY'],
  INVALID: [],
  READY: ['SAVED', 'CANCELLED', 'EXPIRED'],
  SAVED: ['APPLYING', 'CANCELLED', 'EXPIRED'],
  APPLYING: ['SNAPSHOTTED', 'ROLLING_BACK'],
  SNAPSHOTTED: ['WRITTEN', 'ROLLING_BACK'],
  WRITTEN: ['ACTION_RUNNING', 'ROLLING_BACK'],
  ACTION_RUNNING: ['HEALTH_CHECKING', 'ROLLING_BACK'],
  HEALTH_CHECKING: ['COMPLETED', 'ROLLING_BACK'],
  COMPLETED: [],
  ROLLING_BACK: ['ROLLED_BACK', 'ROLLBACK_FAILED'],
  ROLLED_BACK: [],
  ROLLBACK_FAILED: [],
  CANCELLED: [],
  EXPIRED: []
};

function sameEvent(left: ChangeTransitionEvent, right: ChangeTransitionEvent): boolean {
  return (
    left.transitionId === right.transitionId &&
    left.eventId === right.eventId &&
    left.from === right.from &&
    left.to === right.to &&
    left.actorUserId === right.actorUserId &&
    left.occurredAt === right.occurredAt
  );
}

function validateSnapshot(snapshot: ChangeStateSnapshot): void {
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 0) {
    throw new Error('CHANGE_VERSION_INVALID');
  }
  if (!CHANGE_STATES.includes(snapshot.state)) throw new Error('CHANGE_STATE_INVALID');
  const transitionIds = new Set<string>();
  const eventIds = new Set<string>();
  let previousSequence = 0;
  let previousState: ChangeState | undefined;
  for (const event of snapshot.events) {
    if (transitionIds.has(event.transitionId)) throw new Error('CHANGE_TRANSITION_ID_DUPLICATE');
    if (eventIds.has(event.eventId)) throw new Error('CHANGE_EVENT_ID_DUPLICATE');
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) {
      throw new Error('CHANGE_SEQUENCE_NOT_MONOTONIC');
    }
    if (!CHANGE_STATES.includes(event.from) || !CHANGE_STATES.includes(event.to)) {
      throw new Error('CHANGE_STATE_INVALID');
    }
    if (!legalTransitions[event.from].includes(event.to)) {
      throw new Error('CHANGE_EVENT_TRANSITION_INVALID');
    }
    if (event.sequence > snapshot.version) throw new Error('CHANGE_SEQUENCE_INVALID');
    if (previousState !== undefined && event.from !== previousState) {
      throw new Error('CHANGE_EVENT_CHAIN_INVALID');
    }
    transitionIds.add(event.transitionId);
    eventIds.add(event.eventId);
    previousSequence = event.sequence;
    previousState = event.to;
  }
  const lastEvent = snapshot.events.at(-1);
  if (lastEvent && lastEvent.to !== snapshot.state) throw new Error('CHANGE_STATE_EVENT_MISMATCH');
  if (snapshot.version === Number.MAX_SAFE_INTEGER) throw new Error('CHANGE_VERSION_EXHAUSTED');
}

export function transitionChange(input: {
  snapshot: ChangeStateSnapshot;
  to: ChangeState;
  expectedVersion: number;
  transitionId: TransitionId;
  eventId: EventId;
  actorUserId: string;
  occurredAt: string;
}): ChangeStateSnapshot {
  if (!uuidPattern.test(input.transitionId) || !uuidPattern.test(input.eventId)) {
    throw new Error('CHANGE_TRANSITION_ID_INVALID');
  }
  validateSnapshot(input.snapshot);
  const existingById = input.snapshot.events.find(
    (event) => event.transitionId === input.transitionId || event.eventId === input.eventId
  );
  if (existingById) {
    const requested: ChangeTransitionEvent = {
      transitionId: input.transitionId,
      eventId: input.eventId,
      from: existingById.from,
      to: input.to,
      sequence: existingById.sequence,
      actorUserId: input.actorUserId,
      occurredAt: input.occurredAt
    };
    if (
      existingById.to !== input.to ||
      (existingById.transitionId === input.transitionId && !sameEvent(existingById, requested))
    ) {
      throw new Error('CHANGE_IDEMPOTENCY_CONFLICT');
    }
    return input.snapshot;
  }

  if (input.expectedVersion !== input.snapshot.version) {
    throw new Error('CHANGE_VERSION_CONFLICT');
  }
  if (TERMINAL_CHANGE_STATES.has(input.snapshot.state)) {
    throw new Error('CHANGE_TRANSITION_TERMINAL');
  }
  if (!legalTransitions[input.snapshot.state].includes(input.to)) {
    throw new Error('CHANGE_TRANSITION_ILLEGAL');
  }
  if (!input.actorUserId || !Number.isSafeInteger(input.expectedVersion)) {
    throw new Error('CHANGE_TRANSITION_INPUT_INVALID');
  }
  if (!Number.isFinite(Date.parse(input.occurredAt))) {
    throw new Error('CHANGE_TIMESTAMP_INVALID');
  }

  const event: ChangeTransitionEvent = {
    transitionId: input.transitionId,
    eventId: input.eventId,
    from: input.snapshot.state,
    to: input.to,
    sequence: input.snapshot.version + 1,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt
  };
  return {
    ...input.snapshot,
    state: input.to,
    version: input.snapshot.version + 1,
    events: [...input.snapshot.events, event]
  };
}

export function createSupersedingDraft(input: {
  changeId: string;
  source: ChangeStateSnapshot;
  applicationId: string;
  actorUserId: string;
}): ChangeStateSnapshot {
  if (!uuidPattern.test(input.changeId)) throw new Error('CHANGE_ID_INVALID');
  if (input.changeId === input.source.changeId) throw new Error('CHANGE_SUPERSEDES_SELF');
  if (input.applicationId !== input.source.applicationId) {
    throw new Error('CHANGE_SUPERSEDES_APPLICATION_MISMATCH');
  }
  if (!['INVALID', 'READY', 'SAVED'].includes(input.source.state)) {
    throw new Error('CHANGE_SUPERSEDES_STATE_INVALID');
  }
  if (input.source.applicationId.length === 0) throw new Error('CHANGE_APPLICATION_INVALID');
  if (!input.actorUserId) throw new Error('CHANGE_ACTOR_INVALID');
  return {
    changeId: input.changeId,
    applicationId: input.applicationId,
    state: 'DRAFT',
    version: 0,
    events: [],
    supersedesChangeId: input.source.changeId,
    actorUserId: input.actorUserId
  };
}
