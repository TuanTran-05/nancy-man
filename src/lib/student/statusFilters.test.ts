import { describe, expect, it } from 'vitest';
import { matchesStudentStatusFilter } from './statusFilters';

describe('matchesStudentStatusFilter', () => {
  it('treats archived dropped records as archived only', () => {
    const student = {
      studentLifecycle: 'archived',
      enrollmentStatus: 'dropped',
      isRevoked: true,
    };

    expect(matchesStudentStatusFilter(student, 'archived')).toBe(true);
    expect(matchesStudentStatusFilter(student, 'dropped')).toBe(false);
    expect(matchesStudentStatusFilter(student, 'enrolled')).toBe(false);
  });

  it('keeps official dropped enrolled students in the dropped filter', () => {
    const student = {
      studentLifecycle: 'enrolled',
      enrollmentStatus: 'dropped',
      isRevoked: false,
    };

    expect(matchesStudentStatusFilter(student, 'dropped')).toBe(true);
    expect(matchesStudentStatusFilter(student, 'archived')).toBe(false);
  });
});
