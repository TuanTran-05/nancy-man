import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  ADMIN_CLASS_TUITION_HEALTH_COLLECTION,
  ADMIN_CLASS_TUITION_HEALTH_DOC_ID,
} from '../../../../shared/adminClassTuitionSummary.js';

/** Fail-closes ranking immediately after any source mutation. */
export async function invalidateAdminClassTuitionSnapshotHealth(
  db: DocumentStore,
  reason: string,
  now = new Date()
): Promise<void> {
  await db
    .collection(ADMIN_CLASS_TUITION_HEALTH_COLLECTION)
    .doc(ADMIN_CLASS_TUITION_HEALTH_DOC_ID)
    .set(
      {
        healthy: false,
        lastDailyRebuildStatus: 'failed',
        sourceInvalidatedAt: now.toISOString(),
        invalidationReason: reason.slice(0, 120),
      },
      { merge: true }
    );
}
