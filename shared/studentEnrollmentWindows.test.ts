import { describe, expect, it } from 'vitest';
import { readCourseJoins, readLeavePeriods } from './studentEnrollmentWindows.js';

describe('readCourseJoins', () => {
  it('keeps well-formed entries', () => {
    expect(
      readCourseJoins([
        { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' },
      ]),
    ).toEqual([{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' }]);
  });

  it('drops malformed entries and handles non-array input', () => {
    expect(
      readCourseJoins([
        { classId: 'class-1', termStart: '2026-01-05', joinedAt: 'not-a-date' },
        { classId: '', termStart: '2026-01-05', joinedAt: '2026-02-10' },
      ]),
    ).toEqual([]);
    expect(readCourseJoins(undefined)).toEqual([]);
  });

  it('normalizes timestamp-shaped dates', () => {
    expect(
      readCourseJoins([
        {
          classId: 'class-1',
          termStart: '2026-01-05',
          joinedAt: '2026-02-10T08:30:00.000Z',
        },
      ])[0]?.joinedAt,
    ).toBe('2026-02-10');
  });
});

describe('readLeavePeriods', () => {
  it('keeps open periods, notes, and planned return dates', () => {
    expect(
      readLeavePeriods([
        {
          from: '2026-03-02',
          until: null,
          plannedUntil: '2026-03-30',
          classId: 'class-1',
          note: 'Về quê',
        },
      ]),
    ).toEqual([
      {
        from: '2026-03-02',
        until: null,
        plannedUntil: '2026-03-30',
        classId: 'class-1',
        note: 'Về quê',
      },
    ]);
  });

  it('discards a row with malformed until and drops malformed optional dates', () => {
    // A non-null, non-date until must NOT be silently treated as open leave.
    expect(readLeavePeriods([
      {
        from: '2026-03-02',
        until: 'garbage',
        plannedUntil: 'garbage',
        classId: 'class-1',
      },
    ])).toEqual([]);
    // null until (explicitly open) is still valid.
    const [open] = readLeavePeriods([{ from: '2026-03-02', until: null, classId: 'class-1', plannedUntil: 'garbage' }]);
    expect(open?.until).toBeNull();
    expect(open?.plannedUntil).toBeUndefined();
  });

  it('drops malformed required dates and handles non-array input', () => {
    expect(readLeavePeriods([{ from: '', until: null, classId: 'class-1' }])).toEqual([]);
    expect(readLeavePeriods(undefined)).toEqual([]);
  });

  it('rejects impossible calendar dates as malformed evidence', () => {
    expect(readCourseJoins([
      { classId: 'class-1', termStart: '2026-02-30', joinedAt: '2026-02-01' },
    ])).toEqual([]);
    expect(readLeavePeriods([
      { classId: 'class-1', from: '2026-13-01', until: '2026-03-01' },
    ])).toEqual([]);
    expect(readLeavePeriods([
      { classId: 'class-1', from: '2026-02-01', until: '2026-02-30' },
    ])).toEqual([]);
    expect(readLeavePeriods([
      { classId: 'class-1', from: '2026-03-10', until: '2026-03-01' },
    ])).toEqual([]);
  });
});
