import { describe, expect, it } from 'vitest';
import {
  ADMIN_CLASS_TUITION_HEALTH_COLLECTION,
  ADMIN_CLASS_TUITION_HEALTH_DOC_ID,
  ADMIN_CLASS_TUITION_SNAPSHOT_VERSION,
  ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION,
} from '../../../../shared/adminClassTuitionSummary.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import {
  buildAndSaveClassTuitionSnapshot,
  queryAdminClassTuitionRanking,
  rebuildAllAdminClassTuitionSnapshots,
} from './adminClassTuitionSnapshotService.js';

describe('adminClassTuitionSnapshotService', () => {
  const now = new Date('2026-08-16T10:00:00Z');

  it('builds and saves class tuition snapshot with accurate ranking band', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/c1': {
        name: 'Movers 1',
        teacherId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        tuitionFee: 2_000_000,
      },
      'users/t1': { name: 'Cô Lan', role: 'teacher' },
      'student_course_enrollments/e1': {
        id: 'e1',
        studentId: 's1',
        classId: 'c1',
        status: 'active',
        termStart: '2026-06-01',
      },
      'students/s1': { name: 'Minh', studentId: 'HV01' },
      'course_fee_ledgers/l1': {
        id: 'l1',
        studentId: 's1',
        classId: 'c1',
        termStart: '2026-06-01',
        amount: 2_000_000,
        discountTotal: 0,
        paidTotal: 1_850_000, // 92.5% -> nearly_paid
      },
    });

    const doc = await buildAndSaveClassTuitionSnapshot(db as any, 'c1', '2026-06-01', now);

    expect(doc.classId).toBe('c1');
    expect(doc.rankingBand).toBe('nearly_paid');
    expect(doc.paidRatio).toBe(0.925);
    expect(doc.complete).toBe(true);

    const savedSnap = await (db as any)
      .collection(ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION)
      .doc('c1__2026-06-01')
      .get();
    expect(savedSnap.exists).toBe(true);
  });

  it('queries highest outstanding ranking, sorting by debt descending', async () => {
    const { db } = createInMemoryDocumentStore({
      [`${ADMIN_CLASS_TUITION_HEALTH_COLLECTION}/${ADMIN_CLASS_TUITION_HEALTH_DOC_ID}`]: {
        sourceVersion: ADMIN_CLASS_TUITION_SNAPSHOT_VERSION,
        healthy: true,
        expectedCount: 2,
        materializedCount: 2,
        completeCount: 2,
        incompleteCount: 0,
        newestGeneratedAt: now.toISOString(),
      },
      [`${ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION}/c1__2026-06-01`]: {
        id: 'c1__2026-06-01',
        classId: 'c1',
        teacherId: 't1',
        isCurrent: true,
        outstandingTotal: 1_000_000,
        netDueTotal: 10_000_000,
        paidTotal: 9_000_000,
        rankingBand: 'nearly_paid',
        complete: true,
        missingLedgerCount: 0,
        warningRowCount: 0,
      },
      [`${ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION}/c2__2026-06-01`]: {
        id: 'c2__2026-06-01',
        classId: 'c2',
        teacherId: 't2',
        isCurrent: true,
        outstandingTotal: 5_000_000,
        netDueTotal: 10_000_000,
        paidTotal: 5_000_000,
        rankingBand: 'outstanding',
        complete: true,
        missingLedgerCount: 0,
        warningRowCount: 0,
      },
      'classes/c1': { name: 'Lớp 1' },
      'classes/c2': { name: 'Lớp 2' },
      'users/t1': { name: 'Cô Lan' },
      'users/t2': { name: 'Thầy Hùng' },
    });

    const res = await queryAdminClassTuitionRanking(
      db as any,
      {
        criterion: 'highest_outstanding',
        limit: 10,
      },
      now
    );

    expect(res.kind).toBe('class_tuition_ranking');
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].classId).toBe('c2'); // 5M debt comes first
    expect(res.rows[0].className).toBe('Lớp 2');
    expect(res.rows[0].teacherName).toBe('Thầy Hùng');
    expect(res.rows[1].classId).toBe('c1'); // 1M debt comes second
  });

  it('returns no ranking rows when snapshot health is unhealthy', async () => {
    const { db } = createInMemoryDocumentStore({
      [`${ADMIN_CLASS_TUITION_HEALTH_COLLECTION}/${ADMIN_CLASS_TUITION_HEALTH_DOC_ID}`]: {
        sourceVersion: ADMIN_CLASS_TUITION_SNAPSHOT_VERSION,
        healthy: false,
        expectedCount: 1,
        materializedCount: 1,
        completeCount: 1,
        incompleteCount: 0,
        newestGeneratedAt: now.toISOString(),
      },
      [`${ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION}/c1__2026-06-01`]: {
        classId: 'c1',
        isCurrent: true,
        complete: true,
        rankingBand: 'outstanding',
        outstandingTotal: 1_000_000,
      },
    });

    const result = await queryAdminClassTuitionRanking(
      db as any,
      { criterion: 'highest_outstanding' },
      now
    );

    expect(result.rows).toEqual([]);
    expect(result.quality.status).toBe('failed');
  });

  it('rebuilds all snapshots and updates health document', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/c1': {
        name: 'Movers 1',
        teacherId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        tuitionFee: 2_000_000,
      },
      'users/t1': { name: 'Cô Lan', role: 'teacher' },
      'student_course_enrollments/e1': {
        id: 'e1',
        studentId: 's1',
        classId: 'c1',
        status: 'active',
        termStart: '2026-06-01',
      },
      'students/s1': { name: 'Minh', studentId: 'HV01' },
      'course_fee_ledgers/l1': {
        id: 'l1',
        studentId: 's1',
        classId: 'c1',
        termStart: '2026-06-01',
        amount: 2_000_000,
        discountTotal: 0,
        paidTotal: 2_000_000,
      },
    });

    const health = await rebuildAllAdminClassTuitionSnapshots(db as any, { dryRun: false }, now);

    expect(health.healthy).toBe(true);
    expect(health.expectedCount).toBe(1);
    expect(health.materializedCount).toBe(1);
    expect(health.completeCount).toBe(1);

    const savedHealth = await (db as any)
      .collection(ADMIN_CLASS_TUITION_HEALTH_COLLECTION)
      .doc(ADMIN_CLASS_TUITION_HEALTH_DOC_ID)
      .get();
    expect(savedHealth.exists).toBe(true);
    expect(savedHealth.data().healthy).toBe(true);
  });
});
