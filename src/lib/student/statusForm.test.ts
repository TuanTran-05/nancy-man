import { describe, expect, it } from 'vitest';
import { getStudentStatusFormValue, getStudentStatusLocalPatch } from './statusForm';

describe('getStudentStatusFormValue', () => {
  it('uses dropped for archived records even when their raw status is stale active', () => {
    expect(
      getStudentStatusFormValue({
        enrollmentStatus: 'active',
        isRevoked: true,
      })
    ).toBe('dropped');
  });

  it('keeps current active and on-leave records unchanged', () => {
    expect(getStudentStatusFormValue({ enrollmentStatus: 'active' })).toBe('active');
    expect(getStudentStatusFormValue({ enrollmentStatus: 'on_leave' })).toBe('on_leave');
  });

  it('keeps dropped status changes in the enrolled lifecycle', () => {
    expect(getStudentStatusFormValue({ enrollmentStatus: 'dropped' })).toBe('dropped');
    expect(getStudentStatusLocalPatch('dropped', 'Left class')).toEqual({
      enrollmentStatus: 'dropped',
      studentLifecycle: 'enrolled',
      isRevoked: false,
      statusNote: 'Left class',
    });
  });
});
