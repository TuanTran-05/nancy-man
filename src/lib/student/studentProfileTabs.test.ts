import { describe, expect, it } from 'vitest';
import { getVisibleStudentProfileTabs, resolveStudentProfileTab } from './studentProfileTabs';

describe('getVisibleStudentProfileTabs', () => {
  it('admin sees all three tabs', () => {
    expect(getVisibleStudentProfileTabs('admin')).toEqual(['overview', 'academic', 'finance']);
  });

  it('office sees overview + academic', () => {
    expect(getVisibleStudentProfileTabs('office')).toEqual(['overview', 'academic']);
  });

  it('teacher sees overview + academic', () => {
    expect(getVisibleStudentProfileTabs('teacher')).toEqual(['overview', 'academic']);
  });

  it('accounting sees overview + finance', () => {
    expect(getVisibleStudentProfileTabs('accounting')).toEqual(['overview', 'finance']);
  });

  it('unknown role sees only overview', () => {
    expect(getVisibleStudentProfileTabs(undefined)).toEqual(['overview']);
    expect(getVisibleStudentProfileTabs('parent')).toEqual(['overview']);
  });
});

describe('resolveStudentProfileTab', () => {
  it('returns requested tab when visible', () => {
    expect(resolveStudentProfileTab('finance', ['overview', 'finance'])).toBe('finance');
  });

  it('falls back to first visible tab when requested not allowed', () => {
    expect(resolveStudentProfileTab('finance', ['overview', 'academic'])).toBe('overview');
  });

  it('falls back to overview when visible is empty (defensive)', () => {
    expect(resolveStudentProfileTab('finance', [])).toBe('overview');
  });
});
