import type {
  OfficeTeacherClass,
  OfficeTeacherProfile,
  OfficeTeacherSession,
  OfficeTeachersMonthResponse,
} from '../api/officeTeachersApi';
import { buildOfficeTeacherMonthView, type TeacherMonthDay } from '../office/teacherSchedule';
import { shouldCountSessionForPayroll } from '../../../shared/teacherAttendance';

export type TeacherPayrollPaidRow = {
  date: string;
  teacherId: string;
  classId: string;
  className: string;
  weekday: string;
  startTime: string;
  schedule: string;
  amount: number;
  note: string;
  sessionId?: string;
};

export type TeacherPayrollClassSummary = {
  class: OfficeTeacherClass;
  count: number;
  salary: number;
};

export type TeacherPayrollMonthRow = {
  teacher: OfficeTeacherProfile;
  totalSessions: number;
  totalSalary: number;
  classes: Record<string, TeacherPayrollClassSummary>;
  paidRows: TeacherPayrollPaidRow[];
  days: TeacherMonthDay[];
};

export type TeacherPayrollMonthView = {
  month: string;
  range: OfficeTeachersMonthResponse['range'];
  rows: TeacherPayrollMonthRow[];
};

export type BuildTeacherPayrollMonthInput = OfficeTeachersMonthResponse & {
  search?: string;
  teacherIdFilter?: string;
};

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function sessionKey(classId: string, date: string) {
  return `${classId}_${date}`;
}

function positiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function weekdayLabel(date: string) {
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) return '';
  return WEEKDAY_LABELS[value.getDay()] || '';
}

function shouldIncludePayrollRow(input: {
  date: string;
  kind: 'scheduled' | 'makeup';
  session?: OfficeTeacherSession;
}) {
  return shouldCountSessionForPayroll({
    date: input.date,
    sessionStatus: input.session?.status,
    teacherAttendanceStatus: input.session?.teacherAttendanceStatus,
    isScheduledDate: input.kind === 'scheduled',
  });
}

export function buildTeacherPayrollMonthView(
  input: BuildTeacherPayrollMonthInput
): TeacherPayrollMonthView {
  const view = buildOfficeTeacherMonthView(input);
  const classById = new Map(input.classes.map((cls) => [cls.id, cls]));
  const sessionByClassDate = new Map(
    input.sessions.map((session) => [sessionKey(session.classId, session.date), session])
  );

  const rows = view.teachers
    .filter((teacherRow) =>
      input.teacherIdFilter ? teacherRow.teacher.uid === input.teacherIdFilter : true
    )
    .map((teacherRow) => {
      const paidRows = teacherRow.days
        .filter((day) => day.inMonth)
        .flatMap((day) => day.shifts)
        .filter((shift) => {
          const session = sessionByClassDate.get(sessionKey(shift.classId, shift.date));
          return shouldIncludePayrollRow({
            date: shift.date,
            kind: shift.kind,
            session,
          });
        })
        .sort((a, b) =>
          `${a.date} ${a.startTime} ${a.className}`.localeCompare(
            `${b.date} ${b.startTime} ${b.className}`
          )
        )
        .map((shift) => {
          const cls = classById.get(shift.classId);
          const session = sessionByClassDate.get(sessionKey(shift.classId, shift.date));
          const amount =
            positiveNumber(session?.salaryPerSession) || positiveNumber(cls?.salaryPerSession);

          return {
            date: shift.date,
            teacherId: teacherRow.teacher.uid,
            classId: shift.classId,
            className: shift.className,
            weekday: weekdayLabel(shift.date),
            startTime: shift.startTime,
            schedule: shift.schedule,
            amount,
            note: session?.teacherAttendanceNote || '',
            ...(shift.sessionId ? { sessionId: shift.sessionId } : {}),
          };
        });

      const classes = paidRows.reduce<Record<string, TeacherPayrollClassSummary>>(
        (acc, paidRow) => {
          const cls = classById.get(paidRow.classId);
          if (!cls) return acc;
          const existing = acc[paidRow.classId] || { class: cls, count: 0, salary: 0 };
          acc[paidRow.classId] = {
            class: cls,
            count: existing.count + 1,
            salary: existing.salary + paidRow.amount,
          };
          return acc;
        },
        {}
      );

      return {
        teacher: teacherRow.teacher,
        totalSessions: paidRows.length,
        totalSalary: paidRows.reduce((sum, paidRow) => sum + paidRow.amount, 0),
        classes,
        paidRows,
        days: teacherRow.days,
      };
    });

  return {
    month: input.month,
    range: input.range,
    rows,
  };
}
