import { describe, expect, it } from 'vitest';
import { isChannelAllowedForRole, ROLE_ALLOWED_CHANNELS } from './clientRegistry';

describe('client realtime registry', () => {
  it('does not expose retired role or channel registry entries', () => {
    const retiredRole = ['level', 'manager'].join('_');
    const retiredChannel = ['level', 'management'].join('-') as never;

    expect(ROLE_ALLOWED_CHANNELS[retiredRole]).toBeUndefined();
    expect(isChannelAllowedForRole('admin', retiredChannel)).toBe(false);
    expect(isChannelAllowedForRole('teacher', retiredChannel)).toBe(false);
  });

  it('keeps the admissions channel available to supported roles', () => {
    expect(isChannelAllowedForRole('admin', 'admissions')).toBe(true);
    expect(isChannelAllowedForRole('office', 'admissions')).toBe(true);
    expect(isChannelAllowedForRole('teacher', 'admissions')).toBe(false);
  });

  it('allows course-closing only for operational roles', () => {
    for (const role of ['teacher', 'admin', 'office', 'accounting']) {
      expect(isChannelAllowedForRole(role, 'course-closing')).toBe(true);
    }
    expect(isChannelAllowedForRole('parent', 'course-closing')).toBe(false);
    expect(isChannelAllowedForRole('student', 'course-closing')).toBe(false);
  });
});
