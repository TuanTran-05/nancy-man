import { describe, expect, it } from 'vitest';
import { normalizeAuthRole } from './roles.js';

describe('normalizeAuthRole', () => {
  it('normalizes common stored role variants', () => {
    expect(normalizeAuthRole(' accounting ')).toBe('accounting');
    expect(normalizeAuthRole('ACCOUNTANT')).toBe('accounting');
    expect(normalizeAuthRole('ke_toan')).toBe('accounting');
    expect(normalizeAuthRole('Teacher')).toBe('teacher');
  });

  it('rejects retired and unknown roles', () => {
    expect(normalizeAuthRole(['level', 'manager'].join('-'))).toBeNull();
    expect(normalizeAuthRole(['level', 'manager'].join('_'))).toBeNull();
    expect(normalizeAuthRole('owner')).toBeNull();
    expect(normalizeAuthRole(undefined)).toBeNull();
  });
});
