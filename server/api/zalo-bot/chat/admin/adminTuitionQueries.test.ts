import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import {
  COURSE_FEE_LEDGERS_COLLECTION,
  STUDENT_PROFILE_ALIASES_COLLECTION,
  queryAdminStudentTuition,
} from './adminTuitionQueries.js';
import type { ResolvedCanonicalStudent } from './adminEntityResolver.js';

describe('adminTuitionQueries', () => {
  const mockStudent: ResolvedCanonicalStudent = {
    id: 's1_canonical',
    fullName: 'Nguyễn Văn Minh',
    studentCode: 'HV01',
    currentClassId: 'c1',
    currentClassName: 'Movers 1',
    currentTeacherId: 't1',
    teacherName: 'Cô Lan',
    placementStatus: 'studying',
  };

  const now = new Date('2026-08-16T10:00:00Z');

  it('returns missing_ledger when no ledger exists for student', async () => {
    const { db } = createInMemoryDocumentStore({});

    const res = await queryAdminStudentTuition(db as any, mockStudent, now);

    expect(res.kind).toBe('student_tuition');
    expect(res.paymentStatus).toBe('missing_ledger');
    expect(res.grossBilled).toBeNull();
    expect(res.outstandingTotal).toBeNull();
  });

  it('returns paid status when outstanding is 0', async () => {
    const { db } = createInMemoryDocumentStore({
      [`${COURSE_FEE_LEDGERS_COLLECTION}/l1`]: {
        id: 'l1',
        studentId: 's1_canonical',
        classId: 'c1',
        amount: 2_000_000,
        discountTotal: 0,
        paidTotal: 2_000_000,
        dueDate: '2026-08-10',
        termLabel: 'Khóa Hè 2026',
      },
    });

    const res = await queryAdminStudentTuition(db as any, mockStudent, now);

    expect(res.paymentStatus).toBe('paid');
    expect(res.grossBilled).toBe(2_000_000);
    expect(res.paidTotal).toBe(2_000_000);
    expect(res.outstandingTotal).toBe(0);
    expect(res.courseLabel).toBe('Khóa Hè 2026');
  });

  it('returns partial when paid > 0 but outstanding > 0', async () => {
    const { db } = createInMemoryDocumentStore({
      [`${COURSE_FEE_LEDGERS_COLLECTION}/l1`]: {
        id: 'l1',
        studentId: 's1_canonical',
        classId: 'c1',
        amount: 2_000_000,
        discountTotal: 200_000, // net = 1.8M
        paidTotal: 1_000_000, // outstanding = 800k
        dueDate: '2026-08-25',
      },
    });

    const res = await queryAdminStudentTuition(db as any, mockStudent, now);

    expect(res.paymentStatus).toBe('partial');
    expect(res.grossBilled).toBe(2_000_000);
    expect(res.discountTotal).toBe(200_000);
    expect(res.netBilled).toBe(1_800_000);
    expect(res.paidTotal).toBe(1_000_000);
    expect(res.outstandingTotal).toBe(800_000);
  });

  it('returns overdue when unpaid and dueDate has passed', async () => {
    const { db } = createInMemoryDocumentStore({
      [`${COURSE_FEE_LEDGERS_COLLECTION}/l1`]: {
        id: 'l1',
        studentId: 's1_canonical',
        classId: 'c1',
        amount: 1_500_000,
        discountTotal: 0,
        paidTotal: 0,
        dueDate: '2026-08-01', // passed relative to 2026-08-16
      },
    });

    const res = await queryAdminStudentTuition(db as any, mockStudent, now);

    expect(res.paymentStatus).toBe('overdue');
    expect(res.outstandingTotal).toBe(1_500_000);
    expect(res.dueDate).toBe('2026-08-01');
  });

  it('returns waived when 100% discount is applied', async () => {
    const { db } = createInMemoryDocumentStore({
      [`${COURSE_FEE_LEDGERS_COLLECTION}/l1`]: {
        id: 'l1',
        studentId: 's1_canonical',
        classId: 'c1',
        amount: 2_000_000,
        discountTotal: 2_000_000, // 100% waiver
        paidTotal: 0,
      },
    });

    const res = await queryAdminStudentTuition(db as any, mockStudent, now);

    expect(res.paymentStatus).toBe('waived');
    expect(res.netBilled).toBe(0);
    expect(res.outstandingTotal).toBe(0);
  });

  it('queries ledger attached to merged legacy alias', async () => {
    const { db } = createInMemoryDocumentStore({
      [`${STUDENT_PROFILE_ALIASES_COLLECTION}/s1_legacy`]: {
        legacyProfileId: 's1_legacy',
        canonicalProfileId: 's1_canonical',
        mergeRunId: 'run_1',
        reasonCode: 'profile_normalization',
        sourceFingerprint: 'fp1',
        createdBy: 'system',
      },
      [`${COURSE_FEE_LEDGERS_COLLECTION}/l_legacy`]: {
        id: 'l_legacy',
        studentId: 's1_legacy', // attached to legacy alias
        classId: 'c1',
        amount: 2_500_000,
        discountTotal: 0,
        paidTotal: 2_500_000,
      },
    });

    const res = await queryAdminStudentTuition(db as any, mockStudent, now);

    expect(res.paymentStatus).toBe('paid');
    expect(res.grossBilled).toBe(2_500_000);
    expect(res.paidTotal).toBe(2_500_000);
  });
});
