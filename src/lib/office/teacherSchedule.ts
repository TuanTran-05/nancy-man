import { addDays, endOfMonth, format, startOfMonth, startOfWeek } from 'date-fns';
import {
  getClassSessionForDate,
  getScheduledClassDatesInRange,
} from '../../../shared/classSchedule';
import type {
  OfficeTeacherClass,
  OfficeTeacherProfile,
  OfficeTeacherSession,
  OfficeTeacherSubstitute,
} from '../api/officeTeachersApi';
import { teacherPhoneSearchText } from './teacherPhone';

export type TeacherShiftStatus = 'planned' | 'present' | 'absent' | 'cancelled';
export type TeacherShiftKind = 'scheduled' | 'makeup';

export type TeacherMonthShift = {
  id: string;
  date: string;
  teacherId: string;
  classId: string;
  className: string;
  startTime: string;
  schedule: string;
  room: string;
  status: TeacherShiftStatus;
  kind: TeacherShiftKind;
  sessionId?: string;
};

export type TeacherMonthDay = {
  date: string;
  inMonth: boolean;
  shifts: TeacherMonthShift[];
};

export type TeacherMonthRow = {
  teacher: OfficeTeacherProfile;
  classes: OfficeTeacherClass[];
  days: TeacherMonthDay[];
  classCount: number;
  metrics: {
    planned: number;
    taught: number;
    absentOrCancelled: number;
  };
};

export type OfficeTeacherMonthView = {
  month: string;
  days: TeacherMonthDay[];
  teachers: TeacherMonthRow[];
};

type BuildInput = {
  month: string;
  range: { from: string; to: string };
  teachers: OfficeTeacherProfile[];
  classes: OfficeTeacherClass[];
  sessions: OfficeTeacherSession[];
  substitutes: OfficeTeacherSubstitute[];
  search?: string;
};

function buildMonthDays(month: string, shifts: TeacherMonthShift[]): TeacherMonthDay[] {
  const start = startOfWeek(startOfMonth(new Date(`${month}-01T00:00:00`)), { weekStartsOn: 1 });
  const end = endOfMonth(new Date(`${month}-01T00:00:00`));
  const days: TeacherMonthDay[] = [];
  let cursor = start;

  while (days.length < 42) {
    const date = format(cursor, 'yyyy-MM-dd');
    days.push({
      date,
      inMonth: date.startsWith(month),
      shifts: shifts.filter((shift) => shift.date === date),
    });
    cursor = addDays(cursor, 1);
    if (days.length >= 35 && cursor > end) break;
  }

  return days;
}

function sessionStatus(session: OfficeTeacherSession | undefined): TeacherShiftStatus {
  if (!session) return 'planned';
  if (session.status === 'cancelled') return 'cancelled';
  if (session.teacherAttendanceStatus === 'present') return 'present';
  if (session.teacherAttendanceStatus === 'absent') return 'absent';
  return 'planned';
}

function sessionKind(session: OfficeTeacherSession | undefined): TeacherShiftKind {
  return session?.status === 'makeup' ? 'makeup' : 'scheduled';
}

function classHolidays(cls: OfficeTeacherClass): Set<string> {
  return new Set(cls.holidays || []);
}

function scheduledDatesForClass(
  cls: OfficeTeacherClass,
  range: { from: string; to: string }
): string[] {
  const periods = [
    { startDate: cls.startDate, endDate: cls.endDate || range.to },
    ...(cls.terms || []).map((term) => ({
      startDate: term.startDate,
      endDate: term.endDate,
    })),
  ];
  const holidays = classHolidays(cls);
  const dates = new Set<string>();

  periods.forEach((period) => {
    getScheduledClassDatesInRange(
      {
        startDate: period.startDate,
        endDate: period.endDate,
        daysOfWeek: cls.daysOfWeek,
        startTime: cls.startTime,
        schedule: cls.schedule,
        room: cls.room,
        weeklySessions: cls.weeklySessions,
      },
      range.from,
      range.to
    ).forEach((date) => {
      if (!holidays.has(date)) dates.add(date);
    });
  });

  return [...dates].sort();
}

function substituteMap(substitutes: OfficeTeacherSubstitute[]) {
  return new Map(
    substitutes.map((substitute) => [
      `${substitute.classId}_${substitute.date}`,
      substitute.substituteTeacherId,
    ])
  );
}

function shiftFromClass(
  cls: OfficeTeacherClass,
  date: string,
  session: OfficeTeacherSession | undefined,
  substituteTeacherId?: string
): TeacherMonthShift {
  const resolvedSession = getClassSessionForDate(cls, date);
  return {
    id: `${cls.id}_${date}`,
    date,
    teacherId: session?.teacherId || substituteTeacherId || cls.teacherId,
    classId: cls.id,
    className: cls.name,
    startTime: resolvedSession?.startTime || cls.startTime || '',
    schedule: resolvedSession?.schedule || cls.schedule || cls.startTime || '--:--',
    room: resolvedSession?.room || cls.room || '',
    status: sessionStatus(session),
    kind: sessionKind(session),
    ...(session ? { sessionId: session.id } : {}),
  };
}

function matchesSearch(teacher: OfficeTeacherProfile, search: string) {
  const haystack =
    `${teacher.displayName} ${teacher.email || ''} ${teacherPhoneSearchText(teacher.phone)}`.toLowerCase();
  return haystack.includes(search.trim().toLowerCase());
}

export function buildOfficeTeacherMonthView(input: BuildInput): OfficeTeacherMonthView {
  const classesById = new Map(input.classes.map((cls) => [cls.id, cls]));
  const sessionsByClassDate = new Map(
    input.sessions.map((session) => [`${session.classId}_${session.date}`, session])
  );
  const shiftsByTeacher = new Map<string, TeacherMonthShift[]>();
  const substitutesByClassDate = substituteMap(input.substitutes);

  input.classes.forEach((cls) => {
    scheduledDatesForClass(cls, input.range).forEach((date) => {
      const key = `${cls.id}_${date}`;
      const session = sessionsByClassDate.get(key);
      const shift = shiftFromClass(cls, date, session, substitutesByClassDate.get(key));
      const teacherShifts = shiftsByTeacher.get(shift.teacherId) || [];
      teacherShifts.push(shift);
      shiftsByTeacher.set(shift.teacherId, teacherShifts);
    });
  });

  input.sessions.forEach((session) => {
    const key = `${session.classId}_${session.date}`;
    const cls = classesById.get(session.classId);
    if (!cls) return;
    const alreadyPlanned = [...shiftsByTeacher.values()].some((shifts) =>
      shifts.some((shift) => shift.sessionId === session.id || shift.id === key)
    );
    if (alreadyPlanned) return;
    if (session.status !== 'makeup' && session.status !== 'cancelled') return;

    const shift = shiftFromClass(
      cls,
      session.date,
      session,
      substitutesByClassDate.get(`${session.classId}_${session.date}`)
    );
    const teacherShifts = shiftsByTeacher.get(shift.teacherId) || [];
    teacherShifts.push(shift);
    shiftsByTeacher.set(shift.teacherId, teacherShifts);
  });

  const teachers = input.teachers
    .filter((teacher) => (!input.search ? true : matchesSearch(teacher, input.search)))
    .map((teacher) => {
      const shifts = (shiftsByTeacher.get(teacher.uid) || []).sort((a, b) =>
        `${a.date} ${a.startTime} ${a.className}`.localeCompare(
          `${b.date} ${b.startTime} ${b.className}`
        )
      );
      const teacherClasses = input.classes
        .filter((cls) => cls.teacherId === teacher.uid)
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        teacher,
        classes: teacherClasses,
        days: buildMonthDays(input.month, shifts),
        classCount: teacherClasses.length,
        metrics: {
          planned: shifts.length,
          taught: shifts.filter((shift) => shift.status === 'present').length,
          absentOrCancelled: shifts.filter(
            (shift) => shift.status === 'absent' || shift.status === 'cancelled'
          ).length,
        },
      };
    })
    .sort((a, b) => a.teacher.displayName.localeCompare(b.teacher.displayName));

  return {
    month: input.month,
    days: buildMonthDays(input.month, []),
    teachers,
  };
}
