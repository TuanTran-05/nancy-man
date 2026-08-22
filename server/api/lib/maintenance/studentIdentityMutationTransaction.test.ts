import { describe, expect, it } from 'vitest';
import { runStudentIdentityMutationTransaction } from './studentIdentityMutationTransaction.js';
import { StudentIdentityMaintenanceError } from './studentIdentityMaintenance.js';

type MaintenanceMode = 'normal' | 'read_only';

function maintenance(mode: MaintenanceMode, overrides: Record<string, unknown> = {}) {
  return {
    mode,
    activeRunId: mode === 'read_only' ? 'run-1' : null,
    migrationActorId: mode === 'read_only' ? 'migration' : null,
    updatedAt: '2026-08-09T09:00:00.000Z',
    updatedBy: 'operator',
    ...overrides,
  };
}

/**
 * Simulates DocumentStore retrying a transaction after the maintenance document
 * changes. Writes from a discarded attempt never leave this fake, just like a
 * real conflicted DocumentStore transaction.
 */
function fakeTransactionalDb(events: string[], states: ReturnType<typeof maintenance>[]) {
  const ref = { path: '_maintenance/student_identity' };
  return {
    doc: () => ref,
    async runTransaction<T>(callback: (tx: never) => Promise<T>): Promise<T> {
      let value!: T;
      for (const state of states) {
        const tx = {
          async get(target: { path: string }) {
            events.push(`tx.get:${target.path}`);
            return { exists: true, data: () => state };
          },
        };
        value = await callback(tx as never);
      }
      return value;
    },
  } as never;
}

describe('runStudentIdentityMutationTransaction', () => {
  it('reads maintenance before the business callback sees the transaction', async () => {
    const events: string[] = [];
    const db = fakeTransactionalDb(events, [maintenance('normal')]);

    const result = await runStudentIdentityMutationTransaction(
      db,
      { actorId: 'staff-1', operation: 'finance:receipts:create' },
      async () => {
        events.push('business');
        return 'created';
      }
    );

    expect(result).toBe('created');
    expect(events).toEqual(['tx.get:_maintenance/student_identity', 'business']);
  });

  it('delegates normally after maintenance authorizes the transaction', async () => {
    const db = fakeTransactionalDb([], [maintenance('normal')]);

    await expect(
      runStudentIdentityMutationTransaction(
        db,
        { actorId: 'staff-1', operation: 'finance:receipts:create' },
        async () => ({ receiptId: 'receipt-1' })
      )
    ).resolves.toEqual({ receiptId: 'receipt-1' });
  });

  it('refuses maintenance before the business callback runs', async () => {
    const db = fakeTransactionalDb([], [maintenance('read_only')]);
    let businessRan = false;

    await expect(
      runStudentIdentityMutationTransaction(
        db,
        { actorId: 'staff-1', operation: 'finance:receipts:create' },
        async () => {
          businessRan = true;
        }
      )
    ).rejects.toThrow(StudentIdentityMaintenanceError);

    expect(businessRan).toBe(false);
  });

  it('fails closed when a maintenance mode flip retries the transaction', async () => {
    const events: string[] = [];
    const db = fakeTransactionalDb(events, [maintenance('normal'), maintenance('read_only')]);

    await expect(
      runStudentIdentityMutationTransaction(
        db,
        { actorId: 'staff-1', operation: 'finance:receipts:create' },
        async () => {
          events.push('business');
        }
      )
    ).rejects.toThrow(StudentIdentityMaintenanceError);

    expect(events).toEqual([
      'tx.get:_maintenance/student_identity',
      'business',
      'tx.get:_maintenance/student_identity',
    ]);
  });

  it('allows only the matching migration actor and active run', async () => {
    const db = fakeTransactionalDb(
      [],
      [maintenance('read_only', { activeRunId: 'run-9', migrationActorId: 'migration:worker' })]
    );

    await expect(
      runStudentIdentityMutationTransaction(
        db,
        {
          actorId: 'migration:worker',
          operation: 'student-identity:migrate',
          migrationRunId: 'run-9',
        },
        async () => 'migrated'
      )
    ).resolves.toBe('migrated');

    await expect(
      runStudentIdentityMutationTransaction(
        db,
        {
          actorId: 'migration:worker',
          operation: 'student-identity:migrate',
          migrationRunId: 'wrong-run',
        },
        async () => 'must not run'
      )
    ).rejects.toThrow(StudentIdentityMaintenanceError);
  });
});
