import { describe, expect, it } from 'vitest';
import {
  buildOfficeWeeklyDashboardView,
  filterOfficeWeeklyCards,
  getOfficeCourseStatus,
  WEEKDAYS,
} from './weeklyDashboard';
import type { OfficeWeeklyDashboardResponse } from '../api/officeDashboardApi';

const payload: OfficeWeeklyDashboardResponse = {
  serverTime: new Date('2026-06-07T00:00:00.000Z').getTime(),
  teachers: [
    { uid: 'teacher-1', displayName: 'Teacher One' },
    { uid: 'teacher-2', displayName: 'Teacher Two' },
  ],
  studentCounts: {
    'class-1': { currentTotal: 20, active: 18, onLeave: 2 },
    'class-2': { currentTotal: 12, active: 12, onLeave: 0 },
    'class-3': { currentTotal: 9, active: 8, onLeave: 1 },
  },
  classes: [
    {
      id: 'class-1',
      name: 'G5 Starters',
      teacherId: 'teacher-1',
      daysOfWeek: [1, 3],
      startDate: '2026-06-01',
      endDate: '2026-08-29',
      startTime: '17:30',
      schedule: '17:30 - 19:00',
      room: 'Room 2',
      status: 'active',
      grade: 5,
      weeklySessions: [
        { dayOfWeek: 1, startTime: '17:30:00', endTime: '19:00:00' },
        { dayOfWeek: 3, startTime: '19:15:00', endTime: '20:45:00', room: 'Room 4' },
      ],
    },
    {
      id: 'class-2',
      name: 'G9 IELTS',
      teacherId: 'teacher-2',
      daysOfWeek: [1],
      startDate: '2026-03-01',
      endDate: '2026-05-31',
      startTime: '19:15',
      schedule: '19:15 - 20:45',
      status: 'active',
      grade: 9,
    },
    {
      id: 'class-3',
      name: 'G6 Sunday Speaking',
      teacherId: 'teacher-1',
      daysOfWeek: [0],
      startDate: '2026-06-01',
      endDate: '2026-06-15',
      startTime: '09:00',
      schedule: '09:00 - 10:30',
      status: 'active',
      grade: 6,
    },
  ],
};

describe('office weekly dashboard builder', () => {
  it('defines Monday through Sunday with Sunday using day value 0', () => {
    expect(WEEKDAYS.map((day) => day.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('groups classes into fixed weekday columns and keeps ended classes visible', () => {
    const view = buildOfficeWeeklyDashboardView(payload);
    expect(view.days[0].cards.map((card) => card.classId)).toEqual(['class-1', 'class-2']);
    expect(view.days[2].cards.map((card) => card.classId)).toEqual(['class-1']);
    expect(view.days[6].cards.map((card) => card.classId)).toEqual(['class-3']);
    expect(view.days[0].cards[1].courseStatus).toBe('ended');
  });

  it('keeps paused classes visible and labels them as paused instead of ended', () => {
    const view = buildOfficeWeeklyDashboardView({
      ...payload,
      classes: [
        {
          id: 'class-paused',
          name: 'G7 Paused',
          teacherId: 'teacher-1',
          daysOfWeek: [1],
          startDate: '2026-03-01',
          endDate: '2026-05-31',
          startTime: '09:15',
          schedule: '09:15 - 10:45',
          status: 'paused',
          grade: 7,
        },
      ],
    });

    expect(view.days[0].cards.map((card) => card.classId)).toEqual(['class-paused']);
    expect(view.days[0].cards[0].courseStatus).toBe('paused');
    expect(view.metrics.visibleClasses).toBe(1);
    expect(view.metrics.endedClasses).toBe(0);
  });

  it('keeps classes active until they are within 7 days of ending', () => {
    expect(getOfficeCourseStatus('2026-06-01', '2026-08-29', '2026-06-07')).toBe('active');
    expect(getOfficeCourseStatus('2026-03-29', '2026-06-21', '2026-06-08')).toBe('active');
    expect(getOfficeCourseStatus('2026-06-01', '2026-06-21', '2026-06-13')).toBe('active');
    expect(getOfficeCourseStatus('2026-06-01', '2026-06-21', '2026-06-14')).toBe('ending_soon');
    expect(getOfficeCourseStatus('2026-06-01', '2026-06-21', '2026-06-21')).toBe('ending_soon');
    expect(getOfficeCourseStatus('2026-03-01', '2026-05-31', '2026-06-07')).toBe('ended');
  });

  it('applies multi-select filters as intersections', () => {
    const view = buildOfficeWeeklyDashboardView(payload);
    const cards = view.days.flatMap((day) => day.cards);
    const filtered = filterOfficeWeeklyCards(cards, {
      search: '',
      teacherIds: ['teacher-1', 'teacher-2'],
      weekdayValues: [1, 0],
      grades: [5, 6],
    });
    expect(filtered.map((card) => `${card.weekdayValue}:${card.classId}`)).toEqual([
      '1:class-1',
      '0:class-3',
    ]);
  });

  it('searches by class and teacher names', () => {
    const view = buildOfficeWeeklyDashboardView(payload);
    const cards = view.days.flatMap((day) => day.cards);
    expect(
      filterOfficeWeeklyCards(cards, {
        search: 'ielts',
        teacherIds: [],
        weekdayValues: [],
        grades: [],
      }).map((card) => card.classId)
    ).toEqual(['class-2']);
    expect(
      filterOfficeWeeklyCards(cards, {
        search: 'teacher one',
        teacherIds: [],
        weekdayValues: [],
        grades: [],
      }).map((card) => card.classId)
    ).toEqual(['class-1', 'class-1', 'class-3']);
  });

  describe('rollover course selectedTerm logic', () => {
    it('selects active root term when terms array contains old archived terms', () => {
      const rolloverPayload: OfficeWeeklyDashboardResponse = {
        serverTime: new Date('2026-06-07T00:00:00.000Z').getTime(),
        teachers: [{ uid: 'teacher-1', displayName: 'Teacher One' }],
        studentCounts: {},
        classes: [
          {
            id: 'class-rollover-active',
            name: 'G3 Rollover Active',
            teacherId: 'teacher-1',
            daysOfWeek: [1],
            startDate: '2026-05-02',
            endDate: '2026-06-27',
            grade: 3,
            terms: [{ startDate: '2026-03-01', endDate: '2026-04-25' }],
          },
        ],
      };
      const view = buildOfficeWeeklyDashboardView(rolloverPayload);
      const card = view.days[0].cards[0];
      expect(card.startDate).toBe('2026-05-02');
      expect(card.endDate).toBe('2026-06-27');
      expect(card.courseStatus).toBe('active');
    });

    it('selects upcoming root term when terms array contains old archived terms', () => {
      const rolloverPayload: OfficeWeeklyDashboardResponse = {
        serverTime: new Date('2026-06-07T00:00:00.000Z').getTime(),
        teachers: [{ uid: 'teacher-1', displayName: 'Teacher One' }],
        studentCounts: {},
        classes: [
          {
            id: 'class-rollover-upcoming',
            name: 'G3 Rollover Upcoming',
            teacherId: 'teacher-1',
            daysOfWeek: [1],
            startDate: '2026-07-01',
            endDate: '2026-08-31',
            grade: 3,
            terms: [{ startDate: '2026-03-01', endDate: '2026-04-25' }],
          },
        ],
      };
      const view = buildOfficeWeeklyDashboardView(rolloverPayload);
      const card = view.days[0].cards[0];
      expect(card.startDate).toBe('2026-07-01');
      expect(card.endDate).toBe('2026-08-31');
      expect(card.courseStatus).toBe('new');
    });

    it('selects most recently ended term (root) when all terms have ended', () => {
      const rolloverPayload: OfficeWeeklyDashboardResponse = {
        serverTime: new Date('2026-06-07T00:00:00.000Z').getTime(),
        teachers: [{ uid: 'teacher-1', displayName: 'Teacher One' }],
        studentCounts: {},
        classes: [
          {
            id: 'class-rollover-ended',
            name: 'G3 Rollover Ended',
            teacherId: 'teacher-1',
            daysOfWeek: [1],
            startDate: '2026-03-01',
            endDate: '2026-04-30',
            grade: 3,
            terms: [{ startDate: '2026-01-01', endDate: '2026-02-28' }],
          },
        ],
      };
      const view = buildOfficeWeeklyDashboardView(rolloverPayload);
      const card = view.days[0].cards[0];
      expect(card.startDate).toBe('2026-03-01');
      expect(card.endDate).toBe('2026-04-30');
      expect(card.courseStatus).toBe('ended');
    });
  });

  it('uses weekday-specific times for the same class on different dashboard days', () => {
    const view = buildOfficeWeeklyDashboardView(payload);
    const mondayCard = view.days[0].cards.find((card) => card.classId === 'class-1');
    const wednesdayCard = view.days[2].cards.find((card) => card.classId === 'class-1');

    expect(mondayCard).toMatchObject({
      weekdayValue: 1,
      startTime: '17:30',
      schedule: '17:30 - 19:00',
      room: 'Room 2',
    });
    expect(wednesdayCard).toMatchObject({
      weekdayValue: 3,
      startTime: '19:15',
      schedule: '19:15 - 20:45',
      room: 'Room 4',
    });
  });

  it('treats ISO datetime course dates as date-only values', () => {
    expect(
      getOfficeCourseStatus('2026-06-01T00:00:00Z', '2026-06-21T00:00:00Z', '2026-06-14')
    ).toBe('ending_soon');
    expect(
      getOfficeCourseStatus('2026-03-01T00:00:00Z', '2026-05-31T00:00:00Z', '2026-06-07')
    ).toBe('ended');
  });

  it('does not classify malformed end dates using epoch zero', () => {
    expect(getOfficeCourseStatus('2026-06-01', 'not-a-date', '2026-06-07')).toBe('active');
  });

  it('ignores non-array legacy daysOfWeek values without crashing', () => {
    const view = buildOfficeWeeklyDashboardView({
      ...payload,
      classes: [
        {
          ...payload.classes[0],
          weeklySessions: undefined,
          daysOfWeek: 'not-an-array' as any,
        },
      ],
    });

    expect(view.days.flatMap((day) => day.cards)).toEqual([]);
  });
});
