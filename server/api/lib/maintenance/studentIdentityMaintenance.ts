import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';

/**
 * The write guard for the identity maintenance window.
 *
 * The asymmetry here is the whole design, and it is deliberate: a cached
 * `read_only` may reject early, but a cached `normal` may never permit work.
 *
 * The reason is that the two errors are not equally bad. Rejecting a write
 * that would have been allowed costs the operator a retry. Permitting a write
 * during the maintenance window means a student record changes underneath a
 * migration that already fingerprinted it, which surfaces as drift mid-window
 * and can abort a cutover — or worse, is not noticed at all.
 *
 * So every mutation re-reads the document, and every DocumentStore business
 * transaction reads it *through the transaction*, so that a mode flip during
 * the transaction forces a retry rather than slipping through on a stale view.
 *
 * The one bypass is the migration engine itself, and it requires the actor and
 * the run id to match simultaneously. An actor alone is not enough: knowing
 * the engine's actor id would otherwise be a skeleton key.
 */

export const STUDENT_IDENTITY_MAINTENANCE_PATH = '_maintenance/student_identity';

export type StudentIdentityMaintenanceMode = 'normal' | 'read_only';

export type StudentIdentityMaintenanceState = {
  mode: StudentIdentityMaintenanceMode;
  activeRunId: string | null;
  migrationActorId: string | null;
  updatedAt: unknown;
  updatedBy: string;
  generation: number;
};

export type StudentIdentityMutationContext = {
  actorId: string;
  operation: string;
  migrationRunId?: string;
};

export class StudentIdentityMaintenanceError extends Error {
  readonly status = 503;
  /** The API error mapper keys on `statusCode`; without it this becomes a 500. */
  readonly statusCode = 503;
  readonly code = 'STUDENT_IDENTITY_MAINTENANCE';

  constructor(detail: string) {
    super(`STUDENT_IDENTITY_MAINTENANCE: ${detail}`);
    this.name = 'StudentIdentityMaintenanceError';
  }
}

/**
 * Sticky fail-closed latch. Once this process has seen `read_only`, it stays
 * pessimistic until it reads a well-formed `normal` document again — including
 * when the read fails, since an unreadable control document during a
 * maintenance window is not evidence the window closed.
 */
let lastKnownReadOnly = false;

export function resetStudentIdentityMaintenanceCacheForTests(): void {
  lastKnownReadOnly = false;
}

function requiredMode(): boolean {
  return process.env.STUDENT_IDENTITY_MAINTENANCE_REQUIRED === 'true';
}

const BLOCKED: StudentIdentityMaintenanceState = {
  mode: 'read_only',
  activeRunId: null,
  migrationActorId: null,
  updatedAt: null,
  updatedBy: 'fail-closed',
  generation: 0,
};

function parseState(raw: unknown): StudentIdentityMaintenanceState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.mode !== 'normal' && value.mode !== 'read_only') return null;
  return {
    mode: value.mode,
    activeRunId: typeof value.activeRunId === 'string' ? value.activeRunId : null,
    migrationActorId:
      typeof value.migrationActorId === 'string' ? value.migrationActorId : null,
    updatedAt: value.updatedAt ?? null,
    updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : '',
    generation: typeof value.generation === 'number' ? value.generation : 0,
  };
}

export function assertStudentIdentityMaintenanceStateAllowsMutation(
  state: StudentIdentityMaintenanceState,
  context: StudentIdentityMutationContext
): void {
  if (state?.mode === 'normal') return;

  if (state?.mode === 'read_only') {
    // Both must match, and a run must actually be active. Either half alone
    // would turn a known actor id into a way through the window.
    const runActive = typeof state.activeRunId === 'string' && state.activeRunId.length > 0;
    const runMatches = runActive && state.activeRunId === context.migrationRunId;
    const actorMatches =
      typeof state.migrationActorId === 'string' && state.migrationActorId === context.actorId;
    if (runMatches && actorMatches) return;

    throw new StudentIdentityMaintenanceError(
      `${context.operation} is blocked while student identity maintenance is read_only`
    );
  }

  // Anything that is neither mode is malformed, and malformed blocks.
  throw new StudentIdentityMaintenanceError(
    `${context.operation} is blocked because the maintenance state is unreadable`
  );
}

export async function assertStudentIdentityMutationAllowed(
  db: DocumentStore,
  context: StudentIdentityMutationContext
): Promise<void> {
  if (lastKnownReadOnly) {
    // Early rejection only. This branch can never let a write through, so it
    // is safe to skip the read; the reverse shortcut would not be.
    throw new StudentIdentityMaintenanceError(
      `${context.operation} is blocked; last known state was read_only`
    );
  }

  if (typeof db?.doc !== 'function') {
    return;
  }

  let snapshot: { exists: boolean; data?: unknown } | undefined;
  try {
    snapshot = (await db.doc(STUDENT_IDENTITY_MAINTENANCE_PATH).get()) as unknown as {
      exists: boolean;
      data?: unknown;
    };
  } catch (error) {
    if (requiredMode()) {
      throw new StudentIdentityMaintenanceError(
        `${context.operation} is blocked; maintenance state could not be read`
      );
    }
    throw error;
  }

  if (!snapshot?.exists) {
    if (requiredMode()) {
      // A cold serverless instance has no cache to fall back on, which is
      // exactly when a permissive default is most dangerous.
      throw new StudentIdentityMaintenanceError(
        `${context.operation} is blocked; the maintenance control document is missing`
      );
    }
    return;
  }

  const raw = typeof snapshot.data === 'function' ? (snapshot.data as () => unknown)() : snapshot.data;
  const state = parseState(raw);
  if (!state) {
    if (requiredMode()) {
      throw new StudentIdentityMaintenanceError(
        `${context.operation} is blocked; the maintenance state is malformed`
      );
    }
    return;
  }

  lastKnownReadOnly = state.mode === 'read_only';
  assertStudentIdentityMaintenanceStateAllowsMutation(state, context);
}

export async function readStudentIdentityMaintenanceInTransaction(
  tx: Transaction,
  db: DocumentStore
): Promise<StudentIdentityMaintenanceState> {
  try {
    if (typeof db?.doc !== 'function') {
      return { mode: 'normal', activeRunId: null, migrationActorId: null, updatedAt: null, updatedBy: '', generation: 0 };
    }
    const ref = db.doc(STUDENT_IDENTITY_MAINTENANCE_PATH);
    const snapshot = (await tx.get(ref as never)) as unknown as
      | { exists: boolean; data: () => unknown }
      | undefined;
    if (!snapshot || !snapshot.exists) {
      return requiredMode()
        ? BLOCKED
        : { mode: 'normal', activeRunId: null, migrationActorId: null, updatedAt: null, updatedBy: '', generation: 0 };
    }

    const state = parseState(typeof snapshot.data === 'function' ? snapshot.data() : undefined);
    if (!state) return BLOCKED;
    return state;
  } catch (error) {
    if (requiredMode()) return BLOCKED;
    return { mode: 'normal', activeRunId: null, migrationActorId: null, updatedAt: null, updatedBy: '', generation: 0 };
  }
}
