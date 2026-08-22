import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import {
  queryAdminStudentAcademic,
  queryAdminZaloOperations,
} from './adminAcademicAndOpsQueries.js';
import type { ResolvedCanonicalStudent } from './adminEntityResolver.js';
import { makeStudentCourseEnrollmentId } from '../../../../../shared/studentCourseEnrollment.js';

describe('adminAcademicAndOpsQueries', () => {
  const mockStudent: ResolvedCanonicalStudent = {
    id: 's1',
    fullName: 'Nguyễn Văn Minh',
    studentCode: 'HV01',
    currentClassId: 'c1',
    currentClassName: 'Starters 1',
    currentTeacherId: 't1',
    teacherName: 'Cô Lan',
    placementStatus: 'studying',
  };

  const now = new Date('2026-08-16T10:00:00Z');

  it('queries student academic performance from evaluations', async () => {
    const enrollmentId = makeStudentCourseEnrollmentId('s1', 'c1', '2026-08-01');
    const { db } = createInMemoryDocumentStore({
      'students/s1': {
        name: 'Nguyễn Văn Minh',
        studentId: 'HV01',
        enrollmentDate: '2026-08-01',
      },
      'classes/c1': {
        name: 'Starters 1',
        teacherId: 't1',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        daysOfWeek: [1],
      },
      [`student_course_enrollments/${enrollmentId}`]: {
        id: enrollmentId,
        studentId: 's1',
        classId: 'c1',
        status: 'active',
        termStart: '2026-08-01',
        joinedAt: '2026-08-01',
      },
      'attendance/attendance_1': {
        studentId: 's1',
        classId: 'c1',
        date: '2026-08-03',
        status: 'present',
      },
      'evaluations/eval_1': {
        studentId: 's1',
        classId: 'c1',
        date: '2026-08-10',
        attendanceScore: 10,
        homeworkScore: 9,
        testScore: 8.5,
        overallScore: 9.2,
        comment: 'Học sinh tiếp thu tốt, hăng hái phát biểu',
      },
      'evaluations/eval_deleted': {
        studentId: 's1',
        classId: 'c1',
        date: '2026-08-15',
        evaluationType: 'final',
        totalScore: 99,
        isDeleted: true,
      },
      'assignments/a1': { title: 'Bài tập Unit 1', classId: 'c1', maxScore: 100 },
      'submissions/sub1': {
        studentId: 's1',
        classId: 'c1',
        assignmentId: 'a1',
        status: 'graded',
        grade: 90,
        submittedAt: '2026-08-12T00:00:00.000Z',
      },
      'submissions/sub_deleted': {
        studentId: 's1',
        classId: 'c1',
        assignmentId: 'a_deleted',
        status: 'graded',
        grade: 100,
        isDeleted: true,
        submittedAt: '2026-08-13T00:00:00.000Z',
      },
    });

    const res = await queryAdminStudentAcademic(db as any, mockStudent, now);

    expect(res.kind).toBe('student_academic');
    expect(res.student.fullName).toBe('Nguyễn Văn Minh');
    expect(res.evaluations.length).toBe(1);
    expect(res.evaluations[0].score).toBe(8.5);
    expect(res.evaluations[0].strengths[0]).toBe('Học sinh tiếp thu tốt, hăng hái phát biểu');
    expect(res.evaluations[0].type).toBe('midterm');
    expect(res.assignments).toEqual([
      expect.objectContaining({ title: 'Bài tập Unit 1', score: 90, maxScore: 100 }),
    ]);
    expect(res.attendanceSummary).toBeDefined();
    expect(res.quality.status).toBe('complete');
  });

  it('queries Zalo bot operational statistics', async () => {
    const { db, queryLog } = createInMemoryDocumentStore({
      'zalo_bot_messages/m1': {
        status: 'sent',
        messageType: 'fee_reminder',
        createdAt: '2026-08-09T00:00:00.000Z',
      },
      'zalo_bot_messages/m2': {
        status: 'delivered',
        createdAt: '2026-08-10T00:00:00.000Z',
      },
      'zalo_bot_messages/m3': {
        status: 'failed',
        errorCode: 'rate_limited',
        createdAt: '2026-08-11T00:00:00.000Z',
      },
      'zalo_bot_messages/m4': {
        status: 'pending',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
      'zalo_bot_messages/outside_period': {
        status: 'sent',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      'zalo_bot_links/l1': { status: 'active' },
      'zalo_bot_links/l2': { status: 'disabled' },
    });

    const res = await queryAdminZaloOperations(db as any, { period: 'current_month' }, now);

    expect(res.kind).toBe('zalo_operations');
    expect(res.messages.sent).toBe(2);
    expect(res.messages.failed).toBe(1);
    expect(res.backlogs.stalePending).toBe(1);
    expect(res.links.active).toBe(1);
    expect(res.links.disabled).toBe(1);
    expect(res.quality.status).toBe('complete');
    const messagesQuery = queryLog.find((entry: any) => entry.collection === 'zalo_bot_messages');
    expect(messagesQuery?.fields).not.toContain('contentSnapshot');
    expect(messagesQuery?.fields).not.toContain('chatId');
  });
});
