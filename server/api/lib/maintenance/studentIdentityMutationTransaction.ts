import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';
import {
  assertStudentIdentityMaintenanceStateAllowsMutation,
  readStudentIdentityMaintenanceInTransaction,
  StudentIdentityMutationContext,
} from './studentIdentityMaintenance.js';

export type { StudentIdentityMutationContext };

export async function runStudentIdentityMutationTransaction<T>(
  db: DocumentStore,
  context: StudentIdentityMutationContext,
  work: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.runTransaction(async (tx) => {
    const state = await readStudentIdentityMaintenanceInTransaction(tx, db);
    assertStudentIdentityMaintenanceStateAllowsMutation(state, context);
    return work(tx);
  });
}
