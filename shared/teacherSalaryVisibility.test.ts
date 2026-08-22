import { describe, expect, it } from 'vitest';
import { applyTeacherSalaryVisibility, canViewTeacherSalary } from './teacherSalaryVisibility';

describe('teacher salary visibility', () => {
  it('allows admin, accounting and teacher to view salary', () => {
    expect(canViewTeacherSalary('admin')).toBe(true);
    expect(canViewTeacherSalary('accounting')).toBe(true);
    expect(canViewTeacherSalary('teacher')).toBe(true);
  });

  it('denies office, other roles, and missing roles', () => {
    expect(canViewTeacherSalary('office')).toBe(false);
    expect(canViewTeacherSalary('student')).toBe(false);
    expect(canViewTeacherSalary('parent')).toBe(false);
    expect(canViewTeacherSalary('')).toBe(false);
    expect(canViewTeacherSalary(undefined)).toBe(false);
    expect(canViewTeacherSalary(null)).toBe(false);
  });

  it('keeps rows untouched for allowed roles', () => {
    const rows = [{ id: 'class-1', salaryPerSession: 150000 }];

    expect(applyTeacherSalaryVisibility(rows, 'admin')).toEqual([
      { id: 'class-1', salaryPerSession: 150000 },
    ]);
  });

  it('removes the salary key entirely for office rather than zeroing it', () => {
    const rows = [{ id: 'class-1', salaryPerSession: 150000 }];

    const result = applyTeacherSalaryVisibility(rows, 'office');

    expect(result).toEqual([{ id: 'class-1' }]);
    expect('salaryPerSession' in result[0]).toBe(false);
  });

  it('does not mutate the caller rows', () => {
    const rows = [{ id: 'class-1', salaryPerSession: 150000 }];

    applyTeacherSalaryVisibility(rows, 'office');

    expect(rows[0].salaryPerSession).toBe(150000);
  });
});
