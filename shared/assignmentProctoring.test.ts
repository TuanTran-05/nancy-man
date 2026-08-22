import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSIGNMENT_PROCTORING_MODE,
  isAssignmentProctoringMode,
  normalizeAssignmentProctoringMode,
} from './assignmentProctoring';

describe('assignment proctoring mode helpers', () => {
  it('defaults missing and unknown values to strict', () => {
    expect(DEFAULT_ASSIGNMENT_PROCTORING_MODE).toBe('strict');
    expect(normalizeAssignmentProctoringMode(undefined)).toBe('strict');
    expect(normalizeAssignmentProctoringMode(null)).toBe('strict');
    expect(normalizeAssignmentProctoringMode('')).toBe('strict');
    expect(normalizeAssignmentProctoringMode('legacy')).toBe('strict');
  });

  it('preserves supported proctoring modes', () => {
    expect(normalizeAssignmentProctoringMode('strict')).toBe('strict');
    expect(normalizeAssignmentProctoringMode('normal')).toBe('normal');
    expect(isAssignmentProctoringMode('strict')).toBe(true);
    expect(isAssignmentProctoringMode('normal')).toBe(true);
    expect(isAssignmentProctoringMode('relaxed')).toBe(false);
  });
});
