import { describe, expect, it } from 'vitest';
import {
  ADMIN_CLASS_TUITION_HEALTH_COLLECTION,
  ADMIN_CLASS_TUITION_HEALTH_DOC_ID,
  ADMIN_CLASS_TUITION_SNAPSHOT_VERSION,
  ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION,
} from '../../../../../shared/adminClassTuitionSummary.js';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import { queryAdminRanking } from './adminRankingQueries.js';

describe('adminRankingQueries', () => {
  const now = new Date('2026-08-16T10:00:00Z');

  it('queries highest outstanding ranking via ranking query wrapper', async () => {
    const { db } = createInMemoryDocumentStore({
      [`${ADMIN_CLASS_TUITION_HEALTH_COLLECTION}/${ADMIN_CLASS_TUITION_HEALTH_DOC_ID}`]: {
        sourceVersion: ADMIN_CLASS_TUITION_SNAPSHOT_VERSION,
        healthy: true,
        expectedCount: 1,
        materializedCount: 1,
        completeCount: 1,
        incompleteCount: 0,
        newestGeneratedAt: now.toISOString(),
      },
      [`${ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION}/c1__2026-06-01`]: {
        id: 'c1__2026-06-01',
        classId: 'c1',
        teacherId: 't1',
        isCurrent: true,
        outstandingTotal: 4_000_000,
        netDueTotal: 10_000_000,
        paidTotal: 6_000_000,
        rankingBand: 'outstanding',
        complete: true,
        missingLedgerCount: 0,
        warningRowCount: 0,
      },
      'classes/c1': { name: 'Starters 1' },
      'users/t1': { name: 'Thầy Hưng' },
    });

    const res = await queryAdminRanking(
      db as any,
      {
        criterion: 'highest_outstanding',
        limit: 5,
      },
      now
    );

    expect(res.kind).toBe('class_tuition_ranking');
    expect(res.criterion).toBe('highest_outstanding');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].className).toBe('Starters 1');
    expect(res.rows[0].outstandingTotal).toBe(4_000_000);
    expect(res.quality.status).toBe('complete');
  });
});
