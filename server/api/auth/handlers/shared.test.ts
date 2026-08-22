import { describe, expect, it } from 'vitest';
import { inferStaffRoleFromEmail, normalizeStaffRole } from './shared';

describe('staff role normalization', () => {
  it('rejects the retired staff role and email suffix', () => {
    const retiredUnderscoreRole = ['level', 'manager'].join('_');
    const retiredHyphenRole = ['level', 'manager'].join('-');
    const retiredEmail = ['lead.', 'level', 'manager', '@nancy.com'].join('');

    expect(normalizeStaffRole(retiredUnderscoreRole)).toBe('');
    expect(normalizeStaffRole(retiredHyphenRole)).toBe('');
    expect(inferStaffRoleFromEmail(retiredEmail)).toBe('');
  });

  it('keeps supported staff role aliases', () => {
    expect(normalizeStaffRole('teacher')).toBe('teacher');
    expect(normalizeStaffRole('accountant')).toBe('accounting');
    expect(normalizeStaffRole('van phong')).toBe('office');
  });
});