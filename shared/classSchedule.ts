import {
  addMinutes,
  eachDayOfInterval,
  format,
  isAfter,
  isBefore,
  isValid,
  parseISO,
} from 'date-fns';
import { isApiDateOnly, normalizeUserTimeInput } from './dateTimeFormat.js';

export type WeeklyClassSession = {
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  room?: string;
};

export type ResolvedClassSessionTime = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  schedule: string;
  room?: string;
  source: 'weeklySessions' | 'legacy';
};

export type SchedulableClass = {
  startDate?: string;
  endDate?: string;
  daysOfWeek?: number[];
  startTime?: string;
  schedule?: string;
  room?: string;
  weeklySessions?: WeeklyClassSession[];
};

export function isIsoDate(value: string): boolean {
  return isApiDateOnly(value);
}

export function parseIsoDate(value: string): Date {
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : new Date(`${value}T00:00:00`);
}

export function getVietnamTodayStr(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isFutureVietnamDate(date: string, now = new Date()): boolean {
  return date > getVietnamTodayStr(now);
}

export function isWithinClassDateRange(
  cls: Pick<SchedulableClass, 'startDate' | 'endDate'>,
  date: string
): boolean {
  if (!isIsoDate(date)) return false;
  if (cls.startDate && isIsoDate(cls.startDate) && date < cls.startDate) return false;
  if (cls.endDate && isIsoDate(cls.endDate) && date > cls.endDate) return false;
  return true;
}

function normalizeRangeStart(classStart: Date, rangeStart: Date) {
  return isAfter(classStart, rangeStart) ? classStart : rangeStart;
}

function normalizeRangeEnd(classEnd: Date, rangeEnd: Date) {
  return isBefore(classEnd, rangeEnd) ? classEnd : rangeEnd;
}

export function getScheduledClassDatesInRange(
  cls: Pick<
    SchedulableClass,
    'startDate' | 'endDate' | 'daysOfWeek' | 'startTime' | 'schedule' | 'room' | 'weeklySessions'
  >,
  from: string,
  to: string
): string[] {
  if (!cls.startDate || !isIsoDate(cls.startDate) || !isIsoDate(from) || !isIsoDate(to)) return [];
  const scheduledWeekdays = new Set(
    cls.weeklySessions && cls.weeklySessions.length > 0
      ? getWeeklyClassSessions(cls).map((session) => session.dayOfWeek)
      : cls.daysOfWeek || []
  );
  if (scheduledWeekdays.size === 0) return [];

  const rangeStart = parseIsoDate(from);
  const rangeEnd = parseIsoDate(to);
  const classStart = parseIsoDate(cls.startDate);
  const classEnd = cls.endDate && isIsoDate(cls.endDate) ? parseIsoDate(cls.endDate) : rangeEnd;
  const start = normalizeRangeStart(classStart, rangeStart);
  const end = normalizeRangeEnd(classEnd, rangeEnd);
  if (isBefore(end, start)) return [];

  return eachDayOfInterval({ start, end })
    .filter((day) => scheduledWeekdays.has(day.getDay()))
    .map((day) => format(day, 'yyyy-MM-dd'));
}

export function isScheduledClassDate(
  cls: Pick<
    SchedulableClass,
    'startDate' | 'endDate' | 'daysOfWeek' | 'startTime' | 'schedule' | 'room' | 'weeklySessions'
  >,
  date: string
): boolean {
  return getScheduledClassDatesInRange(cls, date, date).includes(date);
}

function normalizeTimeForDisplay(time: string | undefined) {
  if (!time) return '';
  try {
    const normalized = normalizeUserTimeInput(time);
    return normalized.slice(0, 5);
  } catch {
    return '';
  }
}

function addMinutesToTime(time: string | undefined, minutes: number) {
  const start = normalizeTimeForDisplay(time);
  if (!start) return '';
  const [hour, minute] = start.split(':').map(Number);
  const base = new Date(2000, 0, 1, hour, minute, 0, 0);
  const end = addMinutes(base, minutes);
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
}

function timeToMinutes(time: string | undefined): number | null {
  const normalized = normalizeTimeForDisplay(time);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return hour * 60 + minute;
}

function normalizeScheduleRoom(sessionRoom: string | undefined, classRoom: string | undefined) {
  return typeof sessionRoom === 'string' && sessionRoom.trim()
    ? sessionRoom.trim()
    : typeof classRoom === 'string' && classRoom.trim()
      ? classRoom.trim()
      : undefined;
}

function parseScheduleRange(schedule: string | undefined): { startTime: string; endTime: string } {
  const scheduleRange = schedule?.match(
    /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2})?)/
  );
  return {
    startTime: normalizeTimeForDisplay(scheduleRange?.[1]),
    endTime: normalizeTimeForDisplay(scheduleRange?.[2]),
  };
}

function buildResolvedSession(input: {
  dayOfWeek: number;
  startTime?: string;
  endTime?: string;
  schedule?: string;
  room?: string;
  classRoom?: string;
  source: 'weeklySessions' | 'legacy';
}): ResolvedClassSessionTime | null {
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
    return null;
  }
  const scheduleRange = parseScheduleRange(input.schedule);
  const startTime = normalizeTimeForDisplay(input.startTime) || scheduleRange.startTime;
  const endTime = normalizeTimeForDisplay(input.endTime) || scheduleRange.endTime;
  const fallbackEndTime = endTime || addMinutesToTime(startTime, 90);
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(fallbackEndTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null;
  return {
    dayOfWeek: input.dayOfWeek,
    startTime,
    endTime: fallbackEndTime,
    schedule: `${startTime} - ${fallbackEndTime}`,
    room: normalizeScheduleRoom(input.room, input.classRoom),
    source: input.source,
  };
}

function sortResolvedSessions(sessions: ResolvedClassSessionTime[]) {
  return [...sessions].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });
}

export function getWeeklyClassSessions(cls: SchedulableClass): ResolvedClassSessionTime[] {
  const structured = Array.isArray(cls.weeklySessions)
    ? cls.weeklySessions
        .map((session) =>
          buildResolvedSession({
            dayOfWeek: Number(session.dayOfWeek),
            startTime: session.startTime,
            endTime: session.endTime,
            room: session.room,
            classRoom: cls.room,
            source: 'weeklySessions',
          })
        )
        .filter((session): session is ResolvedClassSessionTime => Boolean(session))
    : [];

  if (structured.length > 0) return sortResolvedSessions(structured);

  const legacyDays = Array.isArray(cls.daysOfWeek)
    ? cls.daysOfWeek.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const legacySessions = legacyDays
    .map((dayOfWeek) =>
      buildResolvedSession({
        dayOfWeek,
        startTime: cls.startTime,
        schedule: cls.schedule,
        room: cls.room,
        classRoom: cls.room,
        source: 'legacy',
      })
    )
    .filter((session): session is ResolvedClassSessionTime => Boolean(session));
  return sortResolvedSessions(legacySessions);
}

export function getClassSessionForDate(
  cls: SchedulableClass,
  date: string
): ResolvedClassSessionTime | null {
  if (!isIsoDate(date)) return null;
  const weekday = parseIsoDate(date).getDay();
  return getWeeklyClassSessions(cls).find((session) => session.dayOfWeek === weekday) || null;
}

export function getClassTimeRangeForDate(cls: SchedulableClass, date: string): string {
  return getClassSessionForDate(cls, date)?.schedule || '--:--';
}

export function formatWeeklyClassSchedule(
  cls: SchedulableClass,
  dayLabels: string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
): string {
  const sessions = getWeeklyClassSessions(cls);
  if (sessions.length === 0) return getClassTimeRange(cls);
  return sessions
    .map(
      (session) =>
        `${dayLabels[session.dayOfWeek] || String(session.dayOfWeek)} ${session.schedule}`
    )
    .join(' | ');
}

export function getClassTimeRange(cls: Pick<SchedulableClass, 'startTime' | 'schedule'>): string {
  const start = normalizeTimeForDisplay(cls.startTime);
  const scheduleRange = cls.schedule?.match(
    /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2})?)/
  );
  const scheduleStart = normalizeTimeForDisplay(scheduleRange?.[1]);
  const scheduleEnd = normalizeTimeForDisplay(scheduleRange?.[2]);
  const end = scheduleEnd || addMinutesToTime(start, 90);
  if (start && end) return `${start} - ${end}`;
  if (scheduleStart && scheduleEnd) return `${scheduleStart} - ${scheduleEnd}`;
  return start || cls.schedule || '--:--';
}

export function isExpectedClassSessionOnDate(
  cls: Pick<
    SchedulableClass,
    'startDate' | 'endDate' | 'daysOfWeek' | 'startTime' | 'schedule' | 'room' | 'weeklySessions'
  > & {
    status?: string;
    holidays?: string[];
  },
  date: string,
  systemHolidays: string[] = []
) {
  if (cls.status === 'archived') return false;
  if (!isScheduledClassDate(cls, date)) return false;
  if ([...(cls.holidays || []), ...systemHolidays].includes(date)) return false;
  return true;
}
