import { describe, expect, it } from 'vitest';
import { buildTeacherPayrollMonthView } from './teacherPayrollMonth';
import type { OfficeTeachersMonthResponse } from '../api/officeTeachersApi';

const monthData: OfficeTeachersMonthResponse = {
  month: '2026-06',
  range: { from: '2026-06-01', to: '2026-06-30' },
  serverTime: new Date('2026-06-30T10:00:00.000Z').getTime(),
  teachers: [
    { uid: 'teacher-1', displayName: 'Teacher One', email: 'one@test.com' },
    { uid: 'teacher-2', displayName: 'Teacher Two', email: 'two@test.com' },
    { uid: 'teacher-3', displayName: 'Teacher Three', email: 'three@test.com' },
  ],
  classes: [
    {
      id: 'class-1',
      name: 'Grade 8',
      teacherId: 'teacher-1',
      daysOfWeek: [1, 3],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      startTime: '15:45',
      schedule: '15:45 - 17:15',
      room: 'Room 1',
      status: 'active',
      holidays: [],
      salaryPerSession: 150000,
    },
    {
      id: 'class-2',
      name: 'Grade 3',
      teacherId: 'teacher-2',
      daysOfWeek: [2],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      startTime: '17:30',
      schedule: '17:30 - 19:00',
      room: 'Room 2',
      status: 'active',
      holidays: [],
      salaryPerSession: 175000,
    },
  ],
  sessions: [
    {
      id: 'class-1_2026-06-01',
      classId: 'class-1',
      teacherId: 'teacher-1',
      date: '2026-06-01',
      status: 'taught',
      teacherAttendanceStatus: 'present',
      teacherAttendanceNote: 'On time',
    },
    {
      id: 'class-1_2026-06-03',
      classId: 'class-1',
      teacherId: 'teacher-1',
      date: '2026-06-03',
      status: 'taught',
      teacherAttendanceStatus: 'absent',
    },
    {
      id: 'class-1_2026-06-08',
      classId: 'class-1',
      teacherId: 'teacher-1',
      date: '2026-06-08',
      status: 'cancelled',
      teacherAttendanceStatus: 'present',
    },
    {
      id: 'class-1_2026-06-10',
      classId: 'class-1',
      teacherId: 'teacher-3',
      date: '2026-06-10',
      status: 'taught',
      teacherAttendanceStatus: 'present',
      teacherAttendanceNote: 'Substitute class',
      salaryPerSession: 200000,
    },
    {
      id: 'class-2_2026-06-02',
      classId: 'class-2',
      teacherId: 'teacher-2',
      date: '2026-06-02',
      status: 'taught',
      teacherAttendanceStatus: 'present',
      salaryPerSession: 190000,
    },
  ],
  substitutes: [
    {
      classId: 'class-1',
      date: '2026-06-10',
      substituteTeacherId: 'teacher-3',
    },
  ],
};

describe('buildTeacherPayrollMonthView', () => {
  it('builds one canonical paid monthly payroll view from attendance data', () => {
    const view = buildTeacherPayrollMonthView(monthData);

    expect(view.month).toBe('2026-06');
    expect(view.rows.map((row) => row.teacher.uid)).toEqual([
      'teacher-1',
      'teacher-3',
      'teacher-2',
    ]);

    const originalTeacher = view.rows.find((row) => row.teacher.uid === 'teacher-1');
    const substituteTeacher = view.rows.find((row) => row.teacher.uid === 'teacher-3');
    const secondTeacher = view.rows.find((row) => row.teacher.uid === 'teacher-2');

    expect(originalTeacher?.totalSessions).toBe(1);
    expect(originalTeacher?.totalSalary).toBe(150000);
    expect(originalTeacher?.classes['class-1']).toMatchObject({
      count: 1,
      salary: 150000,
    });
    expect(originalTeacher?.paidRows).toEqual([
      expect.objectContaining({
        date: '2026-06-01',
        classId: 'class-1',
        className: 'Grade 8',
        weekday: 'T2',
        schedule: '15:45 - 17:15',
        amount: 150000,
        note: 'On time',
      }),
    ]);

    expect(substituteTeacher?.totalSessions).toBe(1);
    expect(substituteTeacher?.totalSalary).toBe(200000);
    expect(substituteTeacher?.classes['class-1']).toMatchObject({
      count: 1,
      salary: 200000,
    });
    expect(substituteTeacher?.paidRows[0]).toMatchObject({
      date: '2026-06-10',
      className: 'Grade 8',
      amount: 200000,
      note: 'Substitute class',
    });

    expect(secondTeacher?.totalSessions).toBe(1);
    expect(secondTeacher?.totalSalary).toBe(190000);
  });

  it('filters to one teacher while keeping substitute payroll rows for that teacher', () => {
    const view = buildTeacherPayrollMonthView({
      ...monthData,
      teacherIdFilter: 'teacher-3',
    });

    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].teacher.uid).toBe('teacher-3');
    expect(view.rows[0].totalSalary).toBe(200000);
    expect(view.rows[0].paidRows).toEqual([
      expect.objectContaining({
        date: '2026-06-10',
        classId: 'class-1',
        amount: 200000,
      }),
    ]);
  });

  it('can filter teachers by search term', () => {
    const view = buildTeacherPayrollMonthView({
      ...monthData,
      search: 'two',
    });

    expect(view.rows.map((row) => row.teacher.uid)).toEqual(['teacher-2']);
  });
});
