import { describe, expect, it } from 'vitest';
import { TUITION_DUE_DAYS_AFTER_TERM_START, courseTuitionDueDate } from './tuitionDueDate.js';

describe('course tuition due date', () => {
  it('falls two weeks after the course starts', () => {
    expect(TUITION_DUE_DAYS_AFTER_TERM_START).toBe(14);
    expect(courseTuitionDueDate('2026-06-28')).toBe('2026-07-12');
  });

  it('crosses month and year boundaries', () => {
    expect(courseTuitionDueDate('2026-12-25')).toBe('2027-01-08');
    expect(courseTuitionDueDate('2026-02-20')).toBe('2026-03-06');
  });

  /** DST does not apply in Vietnam, but the UTC anchor keeps the arithmetic safe anywhere. */
  it('adds whole days regardless of the host timezone', () => {
    expect(courseTuitionDueDate('2026-03-29')).toBe('2026-04-12');
  });

  it('returns empty for anything that is not a plain date', () => {
    for (const value of ['', '2026-6-28', 'not-a-date', null, undefined, 20260628]) {
      expect(courseTuitionDueDate(value)).toBe('');
    }
  });
});
