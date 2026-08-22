import { describe, expect, it } from 'vitest';
import { buildOfficeTeacherMonthView } from './teacherSchedule';
import type {
  OfficeTeacherClass,
  OfficeTeacherProfile,
  OfficeTeacherSession,
  OfficeTeacherSubstitute,
} from '../api/officeTeachersApi';

const teachers: OfficeTeacherProfile[] = [
  { uid: 'teacher-1', displayName: 'Teacher One', email: 'one@test.com', phone: '0384072314' },
  { uid: 'teacher-2', displayName: 'Teacher Two', email: 'two@test.com', phone: '' },
];

const classes: OfficeTeacherClass[] = [
  {
    id: 'class-1',
    name: '6A Global Success',
    teacherId: 'teacher-1',
    daysOfWeek: [1, 3],
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    startTime: '17:30',
    schedule: '17:30 - 19:00',
    room: 'Room 2',
    status: 'active',
    holidays: ['2026-06-10'],
    weeklySessions: [
      { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
      { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00', room: 'Room 4' },
    ],
  },
  {
    id: 'class-2',
    name: '7B Global Success',
    teacherId: 'teacher-2',
    daysOfWeek: [5],
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    startTime: '19:00',
    schedule: '19:00 - 20:30',
    room: 'Room 3',
    status: 'active',
    holidays: [],
  },
];

const sessions: OfficeTeacherSession[] = [
  {
    id: 'class-1_2026-06-03',
    classId: 'class-1',
    teacherId: 'teacher-1',
    date: '2026-06-03',
    status: 'taught',
    teacherAttendanceStatus: 'present',
  },
  {
    id: 'class-1_2026-06-15',
    classId: 'class-1',
    teacherId: 'teacher-1',
    date: '2026-06-15',
    status: 'taught',
    teacherAttendanceStatus: 'absent',
  },
  {
    id: 'class-1_2026-06-17',
    classId: 'class-1',
    teacherId: 'teacher-1',
    date: '2026-06-17',
    status: 'cancelled',
  },
  {
    id: 'class-1_2026-06-05',
    classId: 'class-1',
    teacherId: 'teacher-1',
    date: '2026-06-05',
    status: 'makeup',
    teacherAttendanceStatus: 'present',
  },
];

describe('buildOfficeTeacherMonthView', () => {
  it('builds teacher summaries and skips class holidays', () => {
    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers,
      classes,
      sessions,
      substitutes: [],
    });

    const teacher = view.teachers.find((item) => item.teacher.uid === 'teacher-1');
    expect(teacher?.classCount).toBe(1);
    expect(teacher?.metrics.planned).toBe(9);
    expect(teacher?.days.find((day) => day.date === '2026-06-10')?.shifts).toHaveLength(0);
  });

  it('overlays present absent cancelled and makeup statuses', () => {
    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers,
      classes,
      sessions,
      substitutes: [],
    });
    const teacher = view.teachers.find((item) => item.teacher.uid === 'teacher-1');

    expect(teacher?.days.find((day) => day.date === '2026-06-03')?.shifts[0].status).toBe(
      'present'
    );
    expect(teacher?.days.find((day) => day.date === '2026-06-15')?.shifts[0].status).toBe('absent');
    expect(teacher?.days.find((day) => day.date === '2026-06-17')?.shifts[0].status).toBe(
      'cancelled'
    );
    expect(teacher?.days.find((day) => day.date === '2026-06-05')?.shifts[0].status).toBe(
      'present'
    );
    expect(teacher?.days.find((day) => day.date === '2026-06-05')?.shifts[0].kind).toBe('makeup');
    expect(teacher?.metrics.taught).toBe(2);
    expect(teacher?.metrics.absentOrCancelled).toBe(2);
  });

  it('filters teacher rows by name email and phone', () => {
    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers,
      classes,
      sessions,
      substitutes: [],
      search: '0384',
    });

    expect(view.teachers.map((item) => item.teacher.uid)).toEqual(['teacher-1']);
  });

  it('filters teacher rows by the displayed local phone format', () => {
    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers: [
        {
          uid: 'teacher-country-code-phone',
          displayName: 'Country Code Teacher',
          email: 'country-code@test.com',
          phone: '84384072314',
        },
      ],
      classes: [],
      sessions: [],
      substitutes: [],
      search: '0384',
    });

    expect(view.teachers.map((item) => item.teacher.uid)).toEqual(['teacher-country-code-phone']);
  });

  it('filters +84 teacher phones by the displayed local phone format', () => {
    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers: [
        {
          uid: 'teacher-plus-country-code-phone',
          displayName: 'Plus Country Code Teacher',
          email: 'plus-country-code@test.com',
          phone: '+84384072314',
        },
      ],
      classes: [],
      sessions: [],
      substitutes: [],
      search: '0384',
    });

    expect(view.teachers.map((item) => item.teacher.uid)).toEqual([
      'teacher-plus-country-code-phone',
    ]);
  });

  it('includes scheduled dates from historical class terms', () => {
    const termClass: OfficeTeacherClass = {
      id: 'class-term',
      name: 'Term History Class',
      teacherId: 'teacher-1',
      daysOfWeek: [2],
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      startTime: '18:00',
      schedule: '18:00 - 19:30',
      room: 'Room 4',
      status: 'active',
      holidays: ['2026-06-09'],
      terms: [
        {
          id: 'term-june',
          name: 'June term',
          startDate: '2026-06-02',
          endDate: '2026-06-16',
        },
      ],
    };

    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers,
      classes: [termClass],
      sessions: [],
      substitutes: [],
    });

    const teacher = view.teachers.find((item) => item.teacher.uid === 'teacher-1');
    expect(teacher?.metrics.planned).toBe(2);
    expect(teacher?.days.find((day) => day.date === '2026-06-02')?.shifts).toHaveLength(1);
    expect(teacher?.days.find((day) => day.date === '2026-06-09')?.shifts).toHaveLength(0);
    expect(teacher?.days.find((day) => day.date === '2026-06-16')?.shifts).toHaveLength(1);
  });

  it('assigns accepted substitute planned shifts even when no class session exists', () => {
    const substituteClass: OfficeTeacherClass = {
      id: 'class-sub',
      name: 'Substitute Class',
      teacherId: 'teacher-1',
      daysOfWeek: [1],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      startTime: '17:30',
      schedule: '17:30 - 19:00',
      room: 'Room 5',
      status: 'active',
      holidays: [],
    };
    const substitutes: OfficeTeacherSubstitute[] = [
      { classId: 'class-sub', date: '2026-06-01', substituteTeacherId: 'teacher-2' },
    ];

    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers,
      classes: [substituteClass],
      sessions: [],
      substitutes,
    });

    const originalTeacher = view.teachers.find((item) => item.teacher.uid === 'teacher-1');
    const substituteTeacher = view.teachers.find((item) => item.teacher.uid === 'teacher-2');

    expect(originalTeacher?.days.find((day) => day.date === '2026-06-01')?.shifts).toHaveLength(0);
    expect(substituteTeacher?.days.find((day) => day.date === '2026-06-01')?.shifts[0]).toEqual(
      expect.objectContaining({
        classId: 'class-sub',
        teacherId: 'teacher-2',
        status: 'planned',
        kind: 'scheduled',
      })
    );
  });

  it('separates makeup kind from attendance status for metrics', () => {
    const makeupClass: OfficeTeacherClass = {
      id: 'class-makeup',
      name: 'Makeup Class',
      teacherId: 'teacher-1',
      daysOfWeek: [],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      startTime: '19:00',
      schedule: '19:00 - 20:30',
      room: 'Room 6',
      status: 'active',
      holidays: [],
    };
    const makeupSessions: OfficeTeacherSession[] = [
      {
        id: 'class-makeup_2026-06-05',
        classId: 'class-makeup',
        teacherId: 'teacher-1',
        date: '2026-06-05',
        status: 'makeup',
      },
      {
        id: 'class-makeup_2026-06-12',
        classId: 'class-makeup',
        teacherId: 'teacher-1',
        date: '2026-06-12',
        status: 'makeup',
        teacherAttendanceStatus: 'absent',
      },
      {
        id: 'class-makeup_2026-06-19',
        classId: 'class-makeup',
        teacherId: 'teacher-1',
        date: '2026-06-19',
        status: 'makeup',
        teacherAttendanceStatus: 'present',
      },
    ];

    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers,
      classes: [makeupClass],
      sessions: makeupSessions,
      substitutes: [],
    });

    const teacher = view.teachers.find((item) => item.teacher.uid === 'teacher-1');

    expect(teacher?.days.find((day) => day.date === '2026-06-05')?.shifts[0]).toEqual(
      expect.objectContaining({ status: 'planned', kind: 'makeup' })
    );
    expect(teacher?.days.find((day) => day.date === '2026-06-12')?.shifts[0]).toEqual(
      expect.objectContaining({ status: 'absent', kind: 'makeup' })
    );
    expect(teacher?.days.find((day) => day.date === '2026-06-19')?.shifts[0]).toEqual(
      expect.objectContaining({ status: 'present', kind: 'makeup' })
    );
    expect(teacher?.metrics.planned).toBe(3);
    expect(teacher?.metrics.taught).toBe(1);
    expect(teacher?.metrics.absentOrCancelled).toBe(1);
  });

  it('uses date-specific time and room for monthly teacher shifts', () => {
    const view = buildOfficeTeacherMonthView({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers,
      classes,
      sessions,
      substitutes: [],
    });
    const teacher = view.teachers.find((item) => item.teacher.uid === 'teacher-1');

    expect(teacher?.days.find((day) => day.date === '2026-06-01')?.shifts[0]).toMatchObject({
      startTime: '17:30',
      schedule: '17:30 - 19:00',
      room: 'Room 2',
    });
    expect(teacher?.days.find((day) => day.date === '2026-06-03')?.shifts[0]).toMatchObject({
      startTime: '19:15',
      schedule: '19:15 - 20:45',
      room: 'Room 4',
    });
  });
});
