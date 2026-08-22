import { describe, expect, it } from 'vitest';
import {
  ADMIN_CLASS_TUITION_HEALTH_COLLECTION,
  ADMIN_CLASS_TUITION_HEALTH_DOC_ID,
} from '../../../../shared/adminClassTuitionSummary.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { invalidateAdminClassTuitionSnapshotHealth } from './adminClassTuitionSnapshotInvalidation.js';

describe('invalidateAdminClassTuitionSnapshotHealth', () => {
  it('fail-closes ranking health after a source mutation', async () => {
    const { db, store } = createInMemoryDocumentStore({
      [`${ADMIN_CLASS_TUITION_HEALTH_COLLECTION}/${ADMIN_CLASS_TUITION_HEALTH_DOC_ID}`]: {
        healthy: true,
        lastDailyRebuildStatus: 'success',
      },
    });
    const now = new Date('2026-08-16T10:00:00.000Z');

    await invalidateAdminClassTuitionSnapshotHealth(db as any, 'accounting:receipt', now);

    expect(
      store.get(`${ADMIN_CLASS_TUITION_HEALTH_COLLECTION}/${ADMIN_CLASS_TUITION_HEALTH_DOC_ID}`)
    ).toMatchObject({
      healthy: false,
      lastDailyRebuildStatus: 'failed',
      sourceInvalidatedAt: now.toISOString(),
      invalidationReason: 'accounting:receipt',
    });
  });
});
