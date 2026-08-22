import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { readOfficeAcademic } from './readers.js';
import type { UserContext } from '../../lib/auth/authz.js';

const OFFICE: UserContext = { uid: 'office-1', role: 'office', name: 'Office' };

describe('readOfficeAcademic course roster consistency', () => {
  it('uses the course-term roster for rows and closing progress', async () => {
    const normalEnrollmentId = makeStudentCourseEnrollmentId(
      'normal',
      'class-a',
      '2026-06-14'
    );
    const concurrentEnrollmentId = makeStudentCourseEnrollmentId(
      'concurrent',
      'class-a',
      '2026-06-14'
    );
    const { db } = createInMemoryDocumentStore({
      'classes/class-a': {
        name: 'Class A',
        status: 'active',
        teacherId: 'teacher-1',
        currentCourseId: 'course-a',
        startDate: '2026-06-14',
        endDate: '2026-08-08',
      },
      'users/teacher-1': { role: 'teacher', displayName: 'Teacher' },
      'students/normal': {
        name: 'Normal',
        classId: 'class-a',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
      'students/concurrent': {
        name: 'Concurrent',
        classId: 'class-b',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
      [`student_course_enrollments/${normalEnrollmentId}`]: {
        id: normalEnrollmentId,
        studentId: 'normal',
        classId: 'class-a',
        termStart: '2026-06-14',
        termEnd: '2026-08-08',
        status: 'active',
        joinedAt: '2026-06-14',
        endedAt: null,
      },
      [`student_course_enrollments/${concurrentEnrollmentId}`]: {
        id: concurrentEnrollmentId,
        studentId: 'concurrent',
        classId: 'class-a',
        termStart: '2026-06-14',
        termEnd: '2026-08-08',
        status: 'active',
        joinedAt: '2026-06-20',
        endedAt: null,
      },
      'evaluations/final-normal': {
        classId: 'class-a',
        studentId: 'normal',
        evaluationType: 'final',
        termStart: '2026-06-14',
        termEnd: '2026-08-08',
      },
    });

    const payload = (await readOfficeAcademic(
      db,
      OFFICE,
      { query: { view: 'full' } } as never
    )) as any;

    expect(payload.students).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'concurrent', classId: 'class-a' }),
      ])
    );
    expect(payload.summaries['class-a']).toMatchObject({
      eligibleStudentCount: 2,
      finalEvaluationCount: 1,
      isEvaluationComplete: false,
      missingEvaluationStudentIds: ['concurrent'],
      courseClosing: {
        requiredStudentCount: 2,
        finalEvaluationCount: 1,
        missingEvaluationStudentIds: ['concurrent'],
      },
    });
  });
});
