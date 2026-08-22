import { describe, expect, it } from 'vitest';
import {
  courseClosingApproved,
  isJoinedAtInWindow,
  resolveClassJoinWindow,
  resolveClassTermRange,
  resolveTermJoinedAt,
} from './classJoinWindow.js';

const runningClass = { startDate: '2026-07-01', endDate: '2026-09-30' };
const endedClass = { startDate: '2026-01-05', endDate: '2026-03-31' };

describe('resolveClassTermRange', () => {
  it('falls back to the class start/end dates', () => {
    expect(resolveClassTermRange(runningClass, '2026-08-01')).toEqual({
      termStart: '2026-07-01',
      termEnd: '2026-09-30',
    });
  });

  it('prefers a terms[] entry containing today', () => {
    const classData = {
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      terms: [
        { startDate: '2026-01-05', endDate: '2026-03-31' },
        { startDate: '2026-04-01', endDate: '2026-06-30' },
      ],
    };
    expect(resolveClassTermRange(classData, '2026-05-10')).toEqual({
      termStart: '2026-04-01',
      termEnd: '2026-06-30',
    });
  });

  it('treats a missing endDate as an open term', () => {
    expect(resolveClassTermRange({ startDate: '2026-07-01' }, '2027-01-01')).toEqual({
      termStart: '2026-07-01',
      termEnd: null,
    });
  });

  it('returns null for a legacy class with no dates at all', () => {
    expect(resolveClassTermRange({ name: 'Legacy' }, '2026-07-28')).toBeNull();
  });
});

describe('courseClosingApproved', () => {
  it('reads the raw approval a server document carries', () => {
    expect(courseClosingApproved({ courseClosing: { approval: { status: 'approved' } } })).toBe(true);
  });

  it('reads the derived flag a client payload carries', () => {
    expect(courseClosingApproved({ courseClosingApproved: true })).toBe(true);
  });

  it('is false once the approval was invalidated', () => {
    expect(courseClosingApproved({ courseClosing: { approval: { status: 'invalidated' } } })).toBe(
      false
    );
  });

  it('is false when the derived flag is absent', () => {
    expect(courseClosingApproved({ courseClosingApproved: false })).toBe(false);
  });

  it('is false when the class has no closing state', () => {
    expect(courseClosingApproved({})).toBe(false);
  });
});

describe('resolveClassJoinWindow', () => {
  it('reports an open window while the course is running', () => {
    expect(resolveClassJoinWindow(runningClass, '2026-08-01')).toEqual({
      termStart: '2026-07-01',
      termEnd: '2026-09-30',
      isClosed: false,
      closedReason: null,
    });
  });

  it('closes the window once today passes termEnd', () => {
    expect(resolveClassJoinWindow(endedClass, '2026-05-26')).toEqual({
      termStart: '2026-01-05',
      termEnd: '2026-03-31',
      isClosed: true,
      closedReason: 'term_ended',
    });
  });

  it('closes the window on an approved course closing inside the date range', () => {
    const classData = { ...runningClass, courseClosing: { approval: { status: 'approved' } } };
    expect(resolveClassJoinWindow(classData, '2026-08-01')).toEqual({
      termStart: '2026-07-01',
      termEnd: '2026-09-30',
      isClosed: true,
      closedReason: 'closing_completed',
    });
  });

  it('reads the projected approval flag on client class data', () => {
    expect(
      resolveClassJoinWindow({ ...runningClass, courseClosingApproved: true }, '2026-08-01')
        ?.closedReason
    ).toBe('closing_completed');
  });

  it('prefers term_ended when both signals apply', () => {
    const classData = { ...endedClass, courseClosing: { approval: { status: 'approved' } } };
    expect(resolveClassJoinWindow(classData, '2026-05-26')?.closedReason).toBe('term_ended');
  });

  it('returns null for a legacy class with no dates', () => {
    expect(resolveClassJoinWindow({ name: 'Legacy' }, '2026-07-28')).toBeNull();
  });
});

describe('isJoinedAtInWindow', () => {
  const range = { termStart: '2026-07-01', termEnd: '2026-09-30' };

  it('accepts both boundaries', () => {
    expect(isJoinedAtInWindow(range, '2026-07-01')).toBe(true);
    expect(isJoinedAtInWindow(range, '2026-09-30')).toBe(true);
  });

  it('rejects a date outside the term', () => {
    expect(isJoinedAtInWindow(range, '2026-06-30')).toBe(false);
    expect(isJoinedAtInWindow(range, '2026-10-01')).toBe(false);
  });

  it('rejects anything that is not a real ISO date', () => {
    expect(isJoinedAtInWindow(range, '2026-7-1')).toBe(false);
    expect(isJoinedAtInWindow(range, '2026-02-30')).toBe(false);
    expect(isJoinedAtInWindow(range, '')).toBe(false);
  });

  it('has no upper bound on an open term', () => {
    expect(isJoinedAtInWindow({ termStart: '2026-07-01', termEnd: null }, '2030-01-01')).toBe(true);
  });
});

describe('resolveTermJoinedAt', () => {
  const range = { termStart: '2026-07-01', termEnd: '2026-09-30' };

  it('keeps today when it sits inside the term', () => {
    expect(resolveTermJoinedAt(range, '2026-08-15')).toBe('2026-08-15');
  });

  it('raises an early join to the term start', () => {
    expect(resolveTermJoinedAt(range, '2026-06-20')).toBe('2026-07-01');
  });

  it('lowers a join into an ended course to the term end', () => {
    expect(resolveTermJoinedAt(range, '2026-11-05')).toBe('2026-09-30');
  });

  it('leaves an open-ended term uncapped', () => {
    expect(resolveTermJoinedAt({ termStart: '2026-07-01', termEnd: null }, '2027-01-01')).toBe(
      '2027-01-01'
    );
  });
});
