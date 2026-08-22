import type {
  OfficeDashboardClass,
  OfficeDashboardStudentCount,
  OfficeDashboardTeacher,
  OfficeWeeklyDashboardResponse,
} from '../api/officeDashboardApi';
import { getWeeklyClassSessions } from '../../../shared/classSchedule';
import { daysBetweenDateOnly, normalizeDateOnly, toVietnamDateOnly } from './dateOnly';

export type OfficeWeekdayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type OfficeCourseStatus = 'new' | 'active' | 'paused' | 'ending_soon' | 'ended';

export type OfficeWeekday = {
  key: OfficeWeekdayKey;
  value: number;
};

export type OfficeDashboardCard = {
  id: string;
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
  grade: number | null;
  weekdayValue: number;
  startDate: string;
  endDate: string;
  startTime: string;
  schedule: string;
  room: string;
  courseStatus: OfficeCourseStatus;
  counts: OfficeDashboardStudentCount;
};

export type OfficeDashboardDay = OfficeWeekday & {
  cards: OfficeDashboardCard[];
};

export type OfficeWeeklyDashboardView = {
  days: OfficeDashboardDay[];
  teachers: OfficeDashboardTeacher[];
  grades: number[];
  metrics: {
    visibleClasses: number;
    activeStudents: number;
    onLeaveStudents: number;
    endedClasses: number;
  };
};

export type OfficeWeeklyDashboardFilters = {
  search: string;
  teacherIds: string[];
  weekdayValues: number[];
  grades: number[];
};

const EMPTY_COUNTS: OfficeDashboardStudentCount = { currentTotal: 0, active: 0, onLeave: 0 };
const ENDING_SOON_DAYS = 7;

export const WEEKDAYS: OfficeWeekday[] = [
  { key: 'monday', value: 1 },
  { key: 'tuesday', value: 2 },
  { key: 'wednesday', value: 3 },
  { key: 'thursday', value: 4 },
  { key: 'friday', value: 5 },
  { key: 'saturday', value: 6 },
  { key: 'sunday', value: 0 },
];

function selectedTerm(cls: OfficeDashboardClass, today: string) {
  const rootTerm = { startDate: cls.startDate || '', endDate: cls.endDate || '' };
  const terms = (cls.terms?.length ? [...cls.terms, rootTerm] : [rootTerm])
    .filter((term) => term.startDate || term.endDate)
    .map((term) => ({
      startDate: normalizeDateOnly(term.startDate || cls.startDate) || '',
      endDate: normalizeDateOnly(term.endDate || cls.endDate) || '',
    }));

  const current = terms.find(
    (term) => term.startDate <= today && (!term.endDate || term.endDate >= today)
  );
  if (current) return current;

  const upcoming = terms
    .filter((term) => term.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (upcoming) return upcoming;

  return (
    terms.sort((a, b) => b.endDate.localeCompare(a.endDate))[0] || {
      startDate: normalizeDateOnly(cls.startDate) || '',
      endDate: normalizeDateOnly(cls.endDate) || '',
    }
  );
}

export function getOfficeCourseStatus(
  startDate: string,
  endDate: string,
  today: string
): OfficeCourseStatus {
  const normalizedToday = normalizeDateOnly(today);
  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);

  if (!normalizedToday) return 'active';
  if (normalizedEnd && normalizedEnd < normalizedToday) return 'ended';
  if (normalizedStart && normalizedStart > normalizedToday) return 'new';

  const remainingDays = normalizedEnd ? daysBetweenDateOnly(normalizedToday, normalizedEnd) : null;
  if (remainingDays !== null && remainingDays <= ENDING_SOON_DAYS) return 'ending_soon';
  return 'active';
}

function teacherName(teacherId: string, teachersById: Map<string, OfficeDashboardTeacher>) {
  const teacher = teachersById.get(teacherId);
  return teacher?.displayName || teacher?.email || '';
}

function cardForClass(
  cls: OfficeDashboardClass,
  weekdayValue: number,
  teachersById: Map<string, OfficeDashboardTeacher>,
  countsByClass: Record<string, OfficeDashboardStudentCount>,
  today: string
): OfficeDashboardCard {
  const term = selectedTerm(cls, today);
  const session = getWeeklyClassSessions(cls).find((item) => item.dayOfWeek === weekdayValue);
  return {
    id: `${weekdayValue}:${cls.id}`,
    classId: cls.id,
    className: cls.name,
    teacherId: cls.teacherId,
    teacherName: teacherName(cls.teacherId, teachersById),
    grade: cls.grade,
    weekdayValue,
    startDate: term.startDate,
    endDate: term.endDate,
    startTime: session?.startTime || cls.startTime || '',
    schedule: session?.schedule || cls.schedule || cls.startTime || '',
    room: session?.room || cls.room || '',
    courseStatus:
      String(cls.status || '').toLowerCase() === 'paused'
        ? 'paused'
        : getOfficeCourseStatus(term.startDate, term.endDate, today),
    counts: countsByClass[cls.id] || EMPTY_COUNTS,
  };
}

function sortCards(a: OfficeDashboardCard, b: OfficeDashboardCard) {
  const timeDiff = (a.startTime || a.schedule).localeCompare(b.startTime || b.schedule);
  if (timeDiff !== 0) return timeDiff;
  return a.className.localeCompare(b.className);
}

export function buildOfficeWeeklyDashboardView(
  payload: OfficeWeeklyDashboardResponse
): OfficeWeeklyDashboardView {
  const teachersById = new Map(payload.teachers.map((teacher) => [teacher.uid, teacher]));
  const today = toVietnamDateOnly(payload.serverTime);
  const days = WEEKDAYS.map((weekday) => ({
    ...weekday,
    cards: payload.classes
      .filter((cls) => {
        const scheduledWeekdays =
          cls.weeklySessions && cls.weeklySessions.length > 0
            ? getWeeklyClassSessions(cls).map((session) => session.dayOfWeek)
            : Array.isArray(cls.daysOfWeek)
              ? cls.daysOfWeek
              : [];
        return scheduledWeekdays.includes(weekday.value);
      })
      .map((cls) =>
        cardForClass(cls, weekday.value, teachersById, payload.studentCounts || {}, today)
      )
      .sort(sortCards),
  }));
  const uniqueClassCards = new Map<string, OfficeDashboardCard>();
  days.flatMap((day) => day.cards).forEach((card) => uniqueClassCards.set(card.classId, card));
  const classes = [...uniqueClassCards.values()];

  return {
    days,
    teachers: payload.teachers,
    grades: [
      ...new Set(
        payload.classes
          .map((cls) => cls.grade)
          .filter((grade): grade is number => typeof grade === 'number')
      ),
    ].sort((a, b) => a - b),
    metrics: {
      visibleClasses: payload.classes.length,
      activeStudents: classes.reduce((sum, card) => sum + card.counts.active, 0),
      onLeaveStudents: classes.reduce((sum, card) => sum + card.counts.onLeave, 0),
      endedClasses: classes.filter((card) => card.courseStatus === 'ended').length,
    },
  };
}

export function filterOfficeWeeklyCards(
  cards: OfficeDashboardCard[],
  filters: OfficeWeeklyDashboardFilters
) {
  const search = filters.search.trim().toLowerCase();
  const teacherIds = new Set(filters.teacherIds);
  const weekdayValues = new Set(filters.weekdayValues);
  const grades = new Set(filters.grades);

  return cards.filter((card) => {
    if (teacherIds.size > 0 && !teacherIds.has(card.teacherId)) return false;
    if (weekdayValues.size > 0 && !weekdayValues.has(card.weekdayValue)) return false;
    if (grades.size > 0 && (card.grade === null || !grades.has(card.grade))) return false;
    if (!search) return true;
    return `${card.className} ${card.teacherName}`.toLowerCase().includes(search);
  });
}
