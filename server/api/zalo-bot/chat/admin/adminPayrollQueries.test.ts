import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import { queryAdminTeacherPayroll } from './adminPayrollQueries.js';
import type { ResolvedTeacher } from './adminEntityResolver.js';

describe('adminPayrollQueries', () => {
  const now = new Date('2026-08-16T10:00:00Z');
  const actor = { uid: 'admin_1', role: 'admin', isBlocked: false } as any;
  const mockTeacher: ResolvedTeacher = {
    teacherId: 't1',
    teacherName: 'Cô Lan',
  };

  it('computes teacher payroll for single teacher with present sessions', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/c1': {
        name: 'Movers 1',
        teacherId: 't1',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        daysOfWeek: [1], // Mondays
        salaryPerSession: 200_000,
      },
      'users/t1': { name: 'Cô Lan', role: 'teacher' },
      'class_sessions/c1_2026-08-03': {
        classId: 'c1',
        date: '2026-08-03',
        status: 'taught',
        teacherAttendanceStatus: 'present',
        salaryPerSession: 200_000,
      },
      'class_sessions/c1_2026-08-10': {
        classId: 'c1',
        date: '2026-08-10',
        status: 'taught',
        teacherAttendanceStatus: 'present',
        salaryPerSession: 200_000,
      },
      'class_sessions/c1_2026-08-17': {
        classId: 'c1',
        date: '2026-08-17',
        status: 'taught',
        teacherAttendanceStatus: 'absent', // absent must not be counted
        salaryPerSession: 200_000,
      },
    });

    const res = await queryAdminTeacherPayroll(
      db as any,
      {
        period: '2026-08',
        teacher: mockTeacher,
        actor,
      },
      now
    );

    expect(res.kind).toBe('teacher_payroll');
    expect(res.teacherId).toBe('t1');
    expect(res.totalSessions).toBe(2);
    expect(res.accruedSalary).toBe(400_000);
    expect(res.quality.status).toBe('complete');
  });

  it('allocates salary to accepted substitute teacher', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/c1': {
        name: 'Movers 1',
        teacherId: 't1', // Primary teacher is t1
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        daysOfWeek: [1],
        salaryPerSession: 250_000,
      },
      'users/t1': { name: 'Cô Lan', role: 'teacher' },
      'users/t2': { name: 'Thầy Tuấn', role: 'teacher' },
      'substitute_requests/sub1': {
        classId: 'c1',
        date: '2026-08-03',
        substituteTeacherId: 't2', // t2 substitutes
        status: 'accepted',
      },
      'class_sessions/c1_2026-08-03': {
        classId: 'c1',
        date: '2026-08-03',
        status: 'taught',
        teacherAttendanceStatus: 'present',
      },
    });

    // Query for substitute teacher t2
    const resT2 = await queryAdminTeacherPayroll(
      db as any,
      {
        period: '2026-08',
        teacher: { teacherId: 't2', teacherName: 'Thầy Tuấn' },
        actor,
      },
      now
    );

    expect(resT2.totalSessions).toBe(1);
    expect(resT2.accruedSalary).toBe(250_000);

    // Query for primary teacher t1 (should have 0 since t2 substituted)
    const resT1 = await queryAdminTeacherPayroll(
      db as any,
      {
        period: '2026-08',
        teacher: mockTeacher,
        actor,
      },
      now
    );

    expect(resT1.totalSessions).toBe(0);
    expect(resT1.accruedSalary).toBe(0);
  });

  it('computes center-wide teacher payroll summary', async () => {
    const { db } = createInMemoryDocumentStore({
      'classes/c1': {
        name: 'Movers 1',
        teacherId: 't1',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        daysOfWeek: [1],
        salaryPerSession: 200_000,
      },
      'users/t1': { name: 'Cô Lan', role: 'teacher' },
      'class_sessions/c1_2026-08-03': {
        classId: 'c1',
        date: '2026-08-03',
        status: 'taught',
        teacherAttendanceStatus: 'present',
      },
      'class_sessions/c1_2026-08-10': {
        classId: 'c1',
        date: '2026-08-10',
        status: 'taught',
        teacherAttendanceStatus: 'present',
      },
    });

    const res = await queryAdminTeacherPayroll(
      db as any,
      {
        period: '2026-08',
        actor,
      },
      now
    );

    expect(res.kind).toBe('teacher_payroll');
    expect(res.totalSessions).toBe(2);
    expect(res.accruedSalary).toBe(400_000);
  });
});
