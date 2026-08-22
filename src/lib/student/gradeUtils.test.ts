import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSuggestedGrade } from './gradeUtils';

describe('getSuggestedGrade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives grade from canonical internal DOB values', () => {
    expect(getSuggestedGrade('2014-11-09')).toBe(6);
  });

  it('rejects non-canonical or impossible DOB values', () => {
    expect(getSuggestedGrade('09/11/2014')).toBeNull();
    expect(getSuggestedGrade('2014-02-30')).toBeNull();
  });
});
