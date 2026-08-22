import { describe, expect, it } from 'vitest';
import {
  appendCourseJoin,
  openLeavePeriod,
  closeOpenLeavePeriods,
} from './enrollmentWindowWrites.js';

describe('appendCourseJoin', () => {
  it('appends to an empty history', () => {
    const result = appendCourseJoin({}, {
      classId: 'class-1',
      termStart: '2026-01-05',
      joinedAt: '2026-02-10',
    });
    expect(result).toEqual([
      { classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-02-10' },
    ]);
  });

  // Spec D3: returning to a previous class must not overwrite the earlier entry.
  it('keeps earlier courses when the student rejoins the same class later', () => {
    const before = {
      courseJoins: [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-01-05' }],
    };
    const result = appendCourseJoin(before, {
      classId: 'class-1',
      termStart: '2026-06-01',
      joinedAt: '2026-07-15',
    });
    expect(result).toHaveLength(2);
    expect(result[0].termStart).toBe('2026-01-05');
    expect(result[1].termStart).toBe('2026-06-01');
  });

  it('does not duplicate an entry for a course already recorded', () => {
    const before = {
      courseJoins: [{ classId: 'class-1', termStart: '2026-01-05', joinedAt: '2026-01-05' }],
    };
    const result = appendCourseJoin(before, {
      classId: 'class-1',
      termStart: '2026-01-05',
      joinedAt: '2026-03-01',
    });
    expect(result).toHaveLength(1);
    expect(result[0].joinedAt).toBe('2026-01-05');
  });

  it('drops malformed pre-existing entries rather than propagating them', () => {
    const before = { courseJoins: [{ classId: '', termStart: 'x', joinedAt: '' }] };
    const result = appendCourseJoin(before, {
      classId: 'class-1',
      termStart: '2026-01-05',
      joinedAt: '2026-02-10',
    });
    expect(result).toHaveLength(1);
  });
});

describe('openLeavePeriod', () => {
  it('opens a period with a null until when no return date is planned', () => {
    const result = openLeavePeriod({}, {
      from: '2026-03-02',
      until: null,
      classId: 'class-1',
    });
    expect(result).toEqual([{ from: '2026-03-02', until: null, classId: 'class-1' }]);
  });

  // The planned date is recorded, but the period stays OPEN. Writing the plan
  // into `until` would mark the student as already returned on the day they left.
  it('records a planned return date without closing the period', () => {
    const result = openLeavePeriod({}, {
      from: '2026-03-02',
      until: null,
      plannedUntil: '2026-03-30',
      classId: 'class-1',
      note: 'Về quê',
    });
    expect(result[0].until).toBeNull();
    expect(result[0].plannedUntil).toBe('2026-03-30');
    expect(result[0].note).toBe('Về quê');
  });

  it('still blocks a second open period when the first has a plannedUntil', () => {
    const before = {
      leavePeriods: [
        { from: '2026-03-02', until: null, plannedUntil: '2026-03-30', classId: 'class-1' },
      ],
    };
    const result = openLeavePeriod(before, { from: '2026-04-01', until: null, classId: 'class-1' });
    expect(result).toHaveLength(1);
  });

  it('does not open a second period while one is already open', () => {
    const before = { leavePeriods: [{ from: '2026-03-02', until: null, classId: 'class-1' }] };
    const result = openLeavePeriod(before, {
      from: '2026-04-01',
      until: null,
      classId: 'class-1',
    });
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe('2026-03-02');
  });

  it('appends after an earlier closed period', () => {
    const before = {
      leavePeriods: [{ from: '2026-03-02', until: '2026-03-30', classId: 'class-1' }],
    };
    const result = openLeavePeriod(before, {
      from: '2026-05-10',
      until: null,
      classId: 'class-1',
    });
    expect(result).toHaveLength(2);
  });
});

describe('closeOpenLeavePeriods', () => {
  it('closes an open period with the actual return date', () => {
    const before = { leavePeriods: [{ from: '2026-03-02', until: null, classId: 'class-1' }] };
    const result = closeOpenLeavePeriods(before, '2026-03-20');
    expect(result[0].until).toBe('2026-03-20');
  });

  // THE case this contract exists for. The planned date is a guess; the return
  // date is the fact. plannedUntil is preserved untouched for reference.
  it('closes a student who returned earlier than planned', () => {
    const before = {
      leavePeriods: [
        { from: '2026-03-02', until: null, plannedUntil: '2026-03-30', classId: 'class-1' },
      ],
    };
    const result = closeOpenLeavePeriods(before, '2026-03-20');
    expect(result[0].until).toBe('2026-03-20');
    expect(result[0].plannedUntil).toBe('2026-03-30');
  });

  it('leaves already-closed earlier periods untouched', () => {
    const before = {
      leavePeriods: [
        { from: '2026-01-02', until: '2026-01-30', classId: 'class-1' },
        { from: '2026-03-02', until: null, classId: 'class-1' },
      ],
    };
    const result = closeOpenLeavePeriods(before, '2026-03-20');
    expect(result[0].until).toBe('2026-01-30');
    expect(result[1].until).toBe('2026-03-20');
  });

  it('is a no-op when there is no history', () => {
    expect(closeOpenLeavePeriods({}, '2026-03-20')).toEqual([]);
  });
});
