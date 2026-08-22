import { describe, expect, it } from 'vitest';
import { FIXED_AVAILABILITY_SLOTS } from '../../../shared/teacherAvailability';
import type {
  AvailabilityDayKey,
  TeacherAvailabilitySelection,
  TeacherAvailabilitySlot,
  Class,
} from '../../types';
import { getTeacherBusyClassNotes } from './teacherBusyNotes';

const TODAY = '2026-06-03';
const WEDNESDAY: AvailabilityDayKey = 'wed';
const WEDNESDAY_CLASS_DAY = 3;

const wedCSelection: TeacherAvailabilitySelection[] = [{ dayKey: 'wed', slotId: 'C' }];
const wedDSelection: TeacherAvailabilitySelection[] = [{ dayKey: 'wed', slotId: 'D' }];
const wedCandDSelections: TeacherAvailabilitySelection[] = [
  { dayKey: 'wed', slotId: 'C' },
  { dayKey: 'wed', slotId: 'D' },
];

function buildClass(overrides: Partial<Class> = {}): Class {
  return {
    id: 'class-1',
    name: 'Advanced 7',
    schedule: '17:00 - 18:30',
    daysOfWeek: [WEDNESDAY_CLASS_DAY],
    description: '',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    startTime: '17:00',
    teacherId: 'teacher-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function getNotes({
  classes,
  selections = wedCSelection,
  dayKey = WEDNESDAY,
  teacherId = 'teacher-1',
  slots = FIXED_AVAILABILITY_SLOTS as TeacherAvailabilitySlot[],
}: {
  classes: Class[];
  selections?: TeacherAvailabilitySelection[];
  dayKey?: AvailabilityDayKey;
  teacherId?: string;
  slots?: TeacherAvailabilitySlot[];
}) {
  return getTeacherBusyClassNotes({
    classes,
    selections,
    slots,
    teacherId,
    dayKey,
    today: TODAY,
  });
}

describe('getTeacherBusyClassNotes', () => {
  it('returns a note when class time partially overlaps a selected availability slot', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          id: 'class-overlap',
          name: 'Overlap Class',
          schedule: '17:30 - 18:30',
          startTime: '17:30',
        }),
      ],
    });

    expect(notes).toEqual([
      {
        classId: 'class-overlap',
        className: 'Overlap Class',
        timeRange: '17:30 - 18:30',
      },
    ]);
  });

  it('does not return a note when class time is outside the selected availability slot', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          schedule: '14:00 - 15:00',
          startTime: '14:00',
        }),
      ],
    });

    expect(notes).toEqual([]);
  });

  it('does not return notes for paused or archived classes', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          id: 'paused-class',
          status: 'paused',
        }),
        buildClass({
          id: 'archived-class',
          status: 'archived',
        }),
      ],
    });

    expect(notes).toEqual([]);
  });

  it('does not return notes before startDate or after endDate', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          id: 'future-class',
          startDate: '2026-07-01',
          endDate: '2026-12-31',
        }),
        buildClass({
          id: 'ended-class',
          startDate: '2026-01-01',
          endDate: '2026-05-31',
        }),
      ],
    });

    expect(notes).toEqual([]);
  });

  it('returns a note for active classes inside the effective date range', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          id: 'effective-class',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
        }),
      ],
    });

    expect(notes).toEqual([
      {
        classId: 'effective-class',
        className: 'Advanced 7',
        timeRange: '17:00 - 18:30',
      },
    ]);
  });

  it('ignores classes for a different teacher or weekday', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          id: 'other-teacher',
          teacherId: 'teacher-2',
        }),
        buildClass({
          id: 'other-day',
          daysOfWeek: [4],
        }),
      ],
    });

    expect(notes).toEqual([]);
  });

  it('sorts multiple busy classes by start time, class name, then id', () => {
    const notes = getNotes({
      selections: wedCandDSelections,
      classes: [
        buildClass({
          id: 'class-b',
          name: 'Beta',
          schedule: '19:00 - 20:30',
          startTime: '19:00',
        }),
        buildClass({
          id: 'class-a',
          name: 'Alpha',
          schedule: '17:00 - 18:30',
          startTime: '17:00',
        }),
      ],
    });

    expect(notes).toEqual([
      {
        classId: 'class-a',
        className: 'Alpha',
        timeRange: '17:00 - 18:30',
      },
      {
        classId: 'class-b',
        className: 'Beta',
        timeRange: '19:00 - 20:30',
      },
    ]);
  });

  it('ignores invalid or missing class time ranges', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          id: 'invalid-range',
          schedule: 'bad range',
          startTime: '',
        }),
        buildClass({
          id: 'invalid-start',
          schedule: '25:00 - 26:00',
          startTime: '25:00',
        }),
      ],
    });

    expect(notes).toEqual([]);
  });

  it('supports legacy pair selections when matching a weekday', () => {
    const notes = getNotes({
      selections: [{ pairKey: 'wed_fri', slotId: 'C' }],
      classes: [buildClass({ id: 'legacy-pair-class' })],
    });

    expect(notes).toEqual([
      {
        classId: 'legacy-pair-class',
        className: 'Advanced 7',
        timeRange: '17:00 - 18:30',
      },
    ]);
  });

  it('uses the 90-minute fallback when schedule lacks an explicit time range', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          id: 'fallback-time',
          schedule: '',
          startTime: '17:15',
        }),
      ],
    });

    expect(notes).toEqual([
      {
        classId: 'fallback-time',
        className: 'Advanced 7',
        timeRange: '17:15 - 18:45',
      },
    ]);
  });

  it('does not return a note when only an unselected slot overlaps', () => {
    const notes = getNotes({
      selections: wedDSelection,
      classes: [
        buildClass({
          id: 'slot-c-class',
          schedule: '17:00 - 18:30',
          startTime: '17:00',
        }),
      ],
    });

    expect(notes).toEqual([]);
  });

  it('uses the selected weekday time from weeklySessions for busy notes', () => {
    const notes = getNotes({
      classes: [
        buildClass({
          id: 'split-time-class',
          name: 'Split Time',
          daysOfWeek: [1, 3],
          startTime: '17:30:00',
          schedule: '17:30 - 19:00',
          weeklySessions: [
            { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
            { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00' },
          ],
        }),
      ],
      selections: wedDSelection,
    });

    expect(notes).toEqual([
      {
        classId: 'split-time-class',
        className: 'Split Time',
        timeRange: '19:15 - 20:45',
      },
    ]);
  });
});
