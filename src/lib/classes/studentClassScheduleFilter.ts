import { getWeeklyClassSessions } from '../../../shared/classSchedule';
import type { Class } from '../../types';

export interface StudentClassScheduleFilter {
  dayOfWeek: number | null;
  startTime: string | null;
}

export function matchesStudentClassScheduleFilter(
  classInfo: Class,
  filter: StudentClassScheduleFilter
): boolean {
  if (filter.dayOfWeek === null && filter.startTime === null) return true;

  return getWeeklyClassSessions(classInfo).some(
    (session) =>
      (filter.dayOfWeek === null || session.dayOfWeek === filter.dayOfWeek) &&
      (filter.startTime === null || session.startTime === filter.startTime)
  );
}

export function filterStudentClassesBySchedule(
  classes: readonly Class[],
  filter: StudentClassScheduleFilter
): Class[] {
  return classes.filter((classInfo) => matchesStudentClassScheduleFilter(classInfo, filter));
}

export function getStudentClassStartTimes(classes: readonly Class[]): string[] {
  return Array.from(
    new Set(
      classes.flatMap((classInfo) =>
        getWeeklyClassSessions(classInfo).map((session) => session.startTime)
      )
    )
  ).sort((left, right) => left.localeCompare(right));
}
