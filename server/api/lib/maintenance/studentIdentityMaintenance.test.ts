import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertStudentIdentityMaintenanceStateAllowsMutation,
  assertStudentIdentityMutationAllowed,
  readStudentIdentityMaintenanceInTransaction,
  resetStudentIdentityMaintenanceCacheForTests,
  STUDENT_IDENTITY_MAINTENANCE_PATH,
  type StudentIdentityMaintenanceState,
} from './studentIdentityMaintenance.js';

function state(overrides: Partial<StudentIdentityMaintenanceState> = {}): StudentIdentityMaintenanceState {
  return {
    mode: 'normal',
    activeRunId: null,
    migrationActorId: null,
    updatedAt: '2026-08-07T00:00:00.000Z',
    updatedBy: 'ops',
    generation: 0,
    ...overrides,
  };
}

/** DocumentStore stub whose document content and read behaviour the test controls. */
function makeDb(read: () => { exists: boolean; data?: unknown } | Promise<never>) {
  const reads: string[] = [];
  const db = {
    reads,
    doc(path: string) {
      return {
        path,
        async get() {
          reads.push(path);
          return read();
        },
      };
    },
  };
  return db as unknown as Parameters<typeof assertStudentIdentityMutationAllowed>[0] & {
    reads: string[];
  };
}

const CONTEXT = { actorId: 'admin:tt', operation: 'createStudent' };

beforeEach(() => {
  resetStudentIdentityMaintenanceCacheForTests();
  delete process.env.STUDENT_IDENTITY_MAINTENANCE_REQUIRED;
});

afterEach(() => {
  delete process.env.STUDENT_IDENTITY_MAINTENANCE_REQUIRED;
  vi.restoreAllMocks();
});

describe('pure state check', () => {
  it('allows a mutation in normal mode', () => {
    expect(() =>
      assertStudentIdentityMaintenanceStateAllowsMutation(state(), CONTEXT)
    ).not.toThrow();
  });

  it('rejects a mutation in read_only mode with a stable code', () => {
    expect(() =>
      assertStudentIdentityMaintenanceStateAllowsMutation(state({ mode: 'read_only' }), CONTEXT)
    ).toThrow('STUDENT_IDENTITY_MAINTENANCE');
  });

  it('carries HTTP 503 metadata so callers do not invent their own status', () => {
    try {
      assertStudentIdentityMaintenanceStateAllowsMutation(state({ mode: 'read_only' }), CONTEXT);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as { status?: number }).status).toBe(503);
    }
  });

  it('lets the migration actor through on its own run', () => {
    expect(() =>
      assertStudentIdentityMaintenanceStateAllowsMutation(
        state({ mode: 'read_only', activeRunId: 'run-1', migrationActorId: 'migration:engine' }),
        { actorId: 'migration:engine', operation: 'applyMerge', migrationRunId: 'run-1' }
      )
    ).not.toThrow();
  });

  it('rejects the right actor on the wrong run', () => {
    expect(() =>
      assertStudentIdentityMaintenanceStateAllowsMutation(
        state({ mode: 'read_only', activeRunId: 'run-1', migrationActorId: 'migration:engine' }),
        { actorId: 'migration:engine', operation: 'applyMerge', migrationRunId: 'run-2' }
      )
    ).toThrow('STUDENT_IDENTITY_MAINTENANCE');
  });

  it('rejects the wrong actor on the right run', () => {
    expect(() =>
      assertStudentIdentityMaintenanceStateAllowsMutation(
        state({ mode: 'read_only', activeRunId: 'run-1', migrationActorId: 'migration:engine' }),
        { actorId: 'admin:tt', operation: 'applyMerge', migrationRunId: 'run-1' }
      )
    ).toThrow('STUDENT_IDENTITY_MAINTENANCE');
  });

  it('rejects a bypass attempt when no run is active', () => {
    // Otherwise anyone who knows the actor id can write during maintenance.
    expect(() =>
      assertStudentIdentityMaintenanceStateAllowsMutation(
        state({ mode: 'read_only', activeRunId: null, migrationActorId: 'migration:engine' }),
        { actorId: 'migration:engine', operation: 'applyMerge', migrationRunId: 'run-1' }
      )
    ).toThrow('STUDENT_IDENTITY_MAINTENANCE');
  });

  it.each([{ mode: 'paused' }, { mode: '' }, {}])(
    'blocks on the malformed state %j',
    (malformed) => {
      expect(() =>
        assertStudentIdentityMaintenanceStateAllowsMutation(
          malformed as StudentIdentityMaintenanceState,
          CONTEXT
        )
      ).toThrow('STUDENT_IDENTITY_MAINTENANCE');
    }
  );
});

describe('boundary guard reads freshly', () => {
  it('permits a mutation when the live document says normal', async () => {
    const db = makeDb(() => ({ exists: true, data: state() }));

    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).resolves.toBeUndefined();
    expect(db.reads).toEqual([STUDENT_IDENTITY_MAINTENANCE_PATH]);
  });

  it('never reuses an observed normal state to authorize a later mutation', async () => {
    let mode: 'normal' | 'read_only' = 'normal';
    const db = makeDb(() => ({ exists: true, data: state({ mode }) }));

    await assertStudentIdentityMutationAllowed(db, CONTEXT);
    mode = 'read_only';

    // A cached "normal" would let writes continue straight through the
    // maintenance window that was just opened.
    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
    expect(db.reads).toHaveLength(2);
  });

  it('rejects early from the last-known read_only value without reading again', async () => {
    const db = makeDb(() => ({ exists: true, data: state({ mode: 'read_only' }) }));
    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).rejects.toThrow();
    const readsAfterFirst = db.reads.length;

    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );

    // Fail-closed caching is only ever an optimization in the safe direction.
    expect(db.reads).toHaveLength(readsAfterFirst);
  });

  it('blocks when the read itself fails after read_only was once observed', async () => {
    let failing = false;
    const db = makeDb(() => {
      if (failing) return Promise.reject(new Error('documentStore unavailable'));
      return { exists: true, data: state({ mode: 'read_only' }) };
    });
    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).rejects.toThrow();
    failing = true;

    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
  });

  it('allows a missing document during first rollout only', async () => {
    const db = makeDb(() => ({ exists: false }));

    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).resolves.toBeUndefined();
  });

  it('blocks a missing document once the rollout flag is set, even on a fresh process', async () => {
    process.env.STUDENT_IDENTITY_MAINTENANCE_REQUIRED = 'true';
    const db = makeDb(() => ({ exists: false }));

    // A cold serverless instance has no cache to fall back on, which is
    // exactly when a permissive default would be most dangerous.
    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
  });

  it('blocks an unreadable document in required mode', async () => {
    process.env.STUDENT_IDENTITY_MAINTENANCE_REQUIRED = 'true';
    const db = makeDb(() => Promise.reject(new Error('permission denied')));

    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
  });

  it('blocks a malformed document in required mode', async () => {
    process.env.STUDENT_IDENTITY_MAINTENANCE_REQUIRED = 'true';
    const db = makeDb(() => ({ exists: true, data: { mode: 'whatever' } }));

    await expect(assertStudentIdentityMutationAllowed(db, CONTEXT)).rejects.toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
  });
});

describe('transactional read', () => {
  function makeTx(doc: { exists: boolean; data?: unknown }) {
    const reads: string[] = [];
    return {
      reads,
      tx: {
        async get(ref: { path: string }) {
          reads.push(ref.path);
          return { exists: doc.exists, data: () => doc.data };
        },
      },
    };
  }

  it('reads the control document through the transaction, not outside it', async () => {
    const db = makeDb(() => ({ exists: true, data: state() }));
    const { tx, reads } = makeTx({ exists: true, data: state() });

    const result = await readStudentIdentityMaintenanceInTransaction(
      tx as never,
      db as never
    );

    // A read outside the transaction would not force a retry when the mode
    // flips mid-transaction, which is the entire point of this function.
    expect(reads).toEqual([STUDENT_IDENTITY_MAINTENANCE_PATH]);
    expect(db.reads).toEqual([]);
    expect(result.mode).toBe('normal');
  });

  it('reports read_only so the caller aborts before staging writes', async () => {
    const db = makeDb(() => ({ exists: true, data: state() }));
    const { tx } = makeTx({ exists: true, data: state({ mode: 'read_only' }) });

    const result = await readStudentIdentityMaintenanceInTransaction(tx as never, db as never);

    expect(result.mode).toBe('read_only');
    expect(() => assertStudentIdentityMaintenanceStateAllowsMutation(result, CONTEXT)).toThrow(
      'STUDENT_IDENTITY_MAINTENANCE'
    );
  });

  it('treats a missing document as read_only in required mode', async () => {
    process.env.STUDENT_IDENTITY_MAINTENANCE_REQUIRED = 'true';
    const db = makeDb(() => ({ exists: true, data: state() }));
    const { tx } = makeTx({ exists: false });

    const result = await readStudentIdentityMaintenanceInTransaction(tx as never, db as never);

    expect(result.mode).toBe('read_only');
  });
});
