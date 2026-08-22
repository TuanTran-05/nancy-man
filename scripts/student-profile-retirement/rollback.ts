import type { DocumentStore } from '@/server/db/documentStore.js';

export async function assertRollbackReversible(
  db: DocumentStore,
  runId: string
): Promise<void> {
  const boundaryRef = db.doc(`student_profile_retirement_irreversible_boundaries/${runId}`);
  const snapshot = await boundaryRef.get();
  if (snapshot.exists) {
    throw new Error('STUDENT_RETIREMENT_ROLLBACK_IRREVERSIBLE');
  }
}
