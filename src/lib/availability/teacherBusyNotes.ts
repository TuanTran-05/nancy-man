import {
  getClassTimeRange,
  getVietnamTodayStr,
  getWeeklyClassSessions,
} from '../../../shared/classSchedule';
import type {
  AvailabilityDayKey,
  AvailabilityPairKey,
  Class,
  TeacherAvailabilitySelection,
  TeacherAvailabilitySlot,
} from '../../types';

export type TeacherBusyClassNote = {
  classId: string;
  className: string;
  timeRange: string;
};

type ParsedTimeRange = {
  startMinutes: number;
  endMinutes: number;
  timeRange: string;
};

type BusyClassNoteWithSort = TeacherBusyClassNote & {
  startMinutes: number;
};

type GetTeacherBusyClassNotesInput = {
  classes: readonly Class[];
  slots: readonly TeacherAvailabilitySlot[];
  selections: readonly TeacherAvailabilitySelection[];
  teacherId: string;
  dayKey: AvailabilityDayKey;
  today?: string;
};

type GetTeacherBusyClassNotesForSlotsInput = Omit<GetTeacherBusyClassNotesInput, 'selections'>;

const DAY_TO_NUMBER: Record<AvailabilityDayKey, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const PAIR_DAY_KEYS: Record<AvailabilityPairKey, AvailabilityDayKey[]> = {
  tue_thu: ['tue', 'thu'],
  wed_fri: ['wed', 'fri'],
  sat_sun: ['sat', 'sun'],
  sun_mon: ['sun', 'mon'],
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):([0-5]\d)$/;
const TIME_RANGE_RE = /(\d{1,2}:\d{2})\s*[\u002d\u2013]\s*(\d{1,2}:\d{2})/;

const noteCollator = new Intl.Collator('vi', {
  numeric: true,
  sensitivity: 'base',
});

function timeToMinutes(value: string): number | null {
  const match = TIME_RE.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

function formatMinutes(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimeRange(value: string): ParsedTimeRange | null {
  const match = TIME_RANGE_RE.exec(String(value || ''));
  if (!match) return null;

  const startMinutes = timeToMinutes(match[1]);
  const endMinutes = timeToMinutes(match[2]);
  if (startMinutes === null || endMinutes === null) return null;
  if (endMinutes <= startMinutes) return null;

  return {
    startMinutes,
    endMinutes,
    timeRange: `${formatMinutes(startMinutes)} - ${formatMinutes(endMinutes)}`,
  };
}

function resolveClassTimeRange(cls: Class): ParsedTimeRange | null {
  return parseTimeRange(cls.schedule || '') || parseTimeRange(getClassTimeRange(cls));
}

function isEffectiveClassToday(cls: Class, today: string): boolean {
  if (cls.status !== 'active') return false;
  if (cls.startDate && ISO_DATE_RE.test(cls.startDate) && cls.startDate > today) return false;
  if (cls.endDate && ISO_DATE_RE.test(cls.endDate) && cls.endDate < today) return false;
  return true;
}

function selectionMatchesDay(selection: TeacherAvailabilitySelection, dayKey: AvailabilityDayKey) {
  if (selection.dayKey) return selection.dayKey === dayKey;
  if (!selection.pairKey) return false;
  return PAIR_DAY_KEYS[selection.pairKey]?.includes(dayKey) || false;
}

function getSelectedSlotsForDay(
  slots: readonly TeacherAvailabilitySlot[],
  selections: readonly TeacherAvailabilitySelection[],
  dayKey: AvailabilityDayKey
) {
  const selectedSlotIds = new Set(
    selections
      .filter((selection) => selectionMatchesDay(selection, dayKey))
      .map((selection) => selection.slotId)
  );

  return slots.filter((slot) => selectedSlotIds.has(slot.id));
}

function slotOverlapsClass(slot: TeacherAvailabilitySlot, classRange: ParsedTimeRange) {
  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);
  if (slotStart === null || slotEnd === null || slotEnd <= slotStart) return false;
  return classRange.startMinutes < slotEnd && classRange.endMinutes > slotStart;
}

export function getTeacherBusyClassNotesForSlots({
  classes,
  slots,
  teacherId,
  dayKey,
  today = getVietnamTodayStr(),
}: GetTeacherBusyClassNotesForSlotsInput): TeacherBusyClassNote[] {
  if (slots.length === 0) return [];
  const weekdayNumber = DAY_TO_NUMBER[dayKey];
  const notesByClassId = new Map<string, BusyClassNoteWithSort>();

  for (const cls of classes) {
    if (cls.teacherId !== teacherId) continue;
    if (!isEffectiveClassToday(cls, today)) continue;
    if (!Array.isArray(cls.daysOfWeek) || !cls.daysOfWeek.includes(weekdayNumber)) continue;

    const resolvedSession = getWeeklyClassSessions(cls).find(
      (session) => session.dayOfWeek === weekdayNumber
    );
    if (!resolvedSession) continue;

    const classRange = parseTimeRange(resolvedSession.schedule);
    if (!classRange) continue;

    const overlapsSlot = slots.some((slot) => slotOverlapsClass(slot, classRange));
    if (!overlapsSlot) continue;

    notesByClassId.set(cls.id, {
      classId: cls.id,
      className: cls.name || cls.id,
      timeRange: classRange.timeRange,
      startMinutes: classRange.startMinutes,
    });
  }

  return [...notesByClassId.values()]
    .sort((a, b) => {
      const timeCompare = a.startMinutes - b.startMinutes;
      if (timeCompare !== 0) return timeCompare;

      const nameCompare = noteCollator.compare(a.className, b.className);
      if (nameCompare !== 0) return nameCompare;

      return noteCollator.compare(a.classId, b.classId);
    })
    .map(({ startMinutes: _startMinutes, ...note }) => note);
}

export function getTeacherBusyClassNotes({
  classes,
  slots,
  selections,
  teacherId,
  dayKey,
  today = getVietnamTodayStr(),
}: GetTeacherBusyClassNotesInput): TeacherBusyClassNote[] {
  const selectedSlots = getSelectedSlotsForDay(slots, selections, dayKey);

  return getTeacherBusyClassNotesForSlots({
    classes,
    slots: selectedSlots,
    teacherId,
    dayKey,
    today,
  });
}
