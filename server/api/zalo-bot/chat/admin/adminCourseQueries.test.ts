import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import { queryAdminClassCoursePeriod, queryAdminClassTuition } from './adminCourseQueries.js';
import type { ResolvedClass } from './adminEntityResolver.js';

describe('adminCourseQueries', () => {
  const mockClass: ResolvedClass = {
    classId: 'c1',
    className: 'Flyers 1',
    teacherId: 't1',
    teacherName: 'Thầy Tuấn',
  };

  const now = new Date('2026-08-16T10:00:00Z');

  it('queries class course period using buildClassTerms', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/c1': {
        name: 'Flyers 1',
        teacherId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        terms: [
          {
            termId: 'term_1',
            startDate: '2026-06-01',
            endDate: '2026-08-31',
          },
        ],
      },
    });

    const res = await queryAdminClassCoursePeriod(db as any, mockClass, now);

    expect(res.kind).toBe('class_course_period');
    expect(res.classId).toBe('c1');
    expect(res.className).toBe('Flyers 1');
    expect(res.startDate).toBe('2026-06-01');
    expect(res.endDate).toBe('2026-08-31');
    expect(res.quality.status).toBe('complete');
  });

  it('queries class tuition reconciliation report', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/c1': {
        name: 'Flyers 1',
        teacherId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        tuitionFee: 3_000_000,
      },
      'users/t1': {
        name: 'Thầy Tuấn',
        role: 'teacher',
      },
      'student_course_enrollments/e1': {
        id: 'e1',
        studentId: 's1',
        classId: 'c1',
        status: 'active',
        termStart: '2026-06-01',
        termEnd: '2026-08-31',
      },
      'students/s1': {
        name: 'Nguyễn Văn Minh',
        studentId: 'HV01',
      },
      'course_fee_ledgers/l1': {
        id: 'l1',
        studentId: 's1',
        classId: 'c1',
        termStart: '2026-06-01',
        termEnd: '2026-08-31',
        amount: 3_000_000,
        discountTotal: 0,
        paidTotal: 3_000_000,
      },
    });

    const res = await queryAdminClassTuition(db as any, mockClass, now);

    expect(res.kind).toBe('class_tuition');
    expect(res.classId).toBe('c1');
    expect(res.netDueTotal).toBe(3_000_000);
    expect(res.paidTotal).toBe(3_000_000);
    expect(res.outstandingTotal).toBe(0);
    expect(res.quality.status).toBe('complete');
  });
});
