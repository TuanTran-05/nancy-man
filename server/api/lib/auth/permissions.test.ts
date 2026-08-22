import { describe, expect, it } from 'vitest';
import {
  canManageAcademicRecords,
  canManageClassFinanceFields,
  canManageFinance,
  canManageStaff,
  canReviewTrial,
} from './permissions.js';

describe('role capability helpers', () => {
  it('allows office to manage academic records without staff or finance permissions', () => {
    expect(canManageAcademicRecords('office')).toBe(true);
    expect(canManageClassFinanceFields('office')).toBe(true);
    expect(canManageStaff('office')).toBe(false);
    expect(canManageFinance('office')).toBe(false);
    expect(canReviewTrial('office')).toBe(false);
  });

  it('keeps admin as the only global staff manager', () => {
    expect(canManageStaff('admin')).toBe(true);
    expect(canManageStaff('teacher')).toBe(false);
    expect(canManageStaff('accounting')).toBe(false);
    const retiredRole = ['level', 'manager'].join('_');
    expect(canManageStaff(retiredRole)).toBe(false);
  });

  it('keeps accounting scoped to finance', () => {
    expect(canManageFinance('accounting')).toBe(true);
    expect(canManageAcademicRecords('accounting')).toBe(false);
  });
});
