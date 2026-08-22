import { describe, expect, it } from 'vitest';
import {
  canStudentParentLogin,
  deriveStudentLifecycle,
  getLinkedStudentAccessBlock,
  isArchivedLifecycle,
  isCurrentLifecycle,
  type LinkedStudentUserRole,
} from './studentLifecycle';

describe('student lifecycle helpers', () => {
  it('derives legacy active-like records as enrolled', () => {
    expect(deriveStudentLifecycle({ enrollmentStatus: 'active' })).toBe('enrolled');
    expect(deriveStudentLifecycle({})).toBe('enrolled');
  });

  it('keeps dropped enrollment records in the enrolled lifecycle', () => {
    expect(deriveStudentLifecycle({ enrollmentStatus: 'dropped' })).toBe('enrolled');
    expect(isArchivedLifecycle({ enrollmentStatus: 'dropped' })).toBe(false);
    expect(isCurrentLifecycle({ enrollmentStatus: 'dropped' })).toBe(true);
  });

  it('derives soft-deleted records as archived even when their status is stale active', () => {
    expect(deriveStudentLifecycle({ enrollmentStatus: 'active', isRevoked: true })).toBe(
      'archived'
    );
    expect(
      deriveStudentLifecycle({
        studentLifecycle: 'enrolled',
        enrollmentStatus: 'active',
        isRevoked: true,
      })
    ).toBe('archived');
    expect(deriveStudentLifecycle({ enrollmentStatus: 'active', deletedAt: '2026-05-24' })).toBe(
      'archived'
    );
  });

  it('blocks trial and archived records from student or parent login', () => {
    expect(canStudentParentLogin({ studentLifecycle: 'trial' })).toBe(false);
    expect(canStudentParentLogin({ studentLifecycle: 'pending' })).toBe(false);
    expect(canStudentParentLogin({ studentLifecycle: 'archived' })).toBe(false);
    expect(
      canStudentParentLogin({ studentLifecycle: 'enrolled', enrollmentStatus: 'active' })
    ).toBe(true);
  });

  it('treats enrolled and trial records as current for duplicate protection', () => {
    expect(isCurrentLifecycle({ studentLifecycle: 'enrolled' })).toBe(true);
    expect(isCurrentLifecycle({ studentLifecycle: 'trial' })).toBe(true);
    expect(isCurrentLifecycle({ studentLifecycle: 'pending' })).toBe(false);
    expect(isCurrentLifecycle({ studentLifecycle: 'archived' })).toBe(false);
  });
});

describe('linked student access policy', () => {
  const now = Date.parse('2026-05-28T00:00:00.000Z');

  it('blocks student login immediately when enrollment is dropped', () => {
    expect(
      getLinkedStudentAccessBlock(
        {
          studentLifecycle: 'enrolled',
          enrollmentStatus: 'dropped',
          statusChangedAt: '2026-05-27T00:00:00.000Z',
        },
        'student',
        now
      )
    ).toEqual({ reason: 'dropped_student' });
  });

  it('allows parent login during the 30 day dropped grace period', () => {
    expect(
      getLinkedStudentAccessBlock(
        {
          studentLifecycle: 'enrolled',
          enrollmentStatus: 'dropped',
          statusChangedAt: '2026-05-10T00:00:00.000Z',
        },
        'parent',
        now
      )
    ).toBeNull();
  });

  it('blocks parent login after the dropped grace period', () => {
    expect(
      getLinkedStudentAccessBlock(
        {
          studentLifecycle: 'enrolled',
          enrollmentStatus: 'dropped',
          statusChangedAt: '2026-04-01T00:00:00.000Z',
        },
        'parent',
        now
      )
    ).toEqual({ reason: 'dropped_parent' });
  });

  it('blocks parent login for dropped records with no reliable dropped date', () => {
    expect(
      getLinkedStudentAccessBlock(
        { studentLifecycle: 'enrolled', enrollmentStatus: 'dropped' },
        'parent',
        now
      )
    ).toEqual({ reason: 'dropped_parent' });
  });

  it.each<LinkedStudentUserRole>(['student', 'parent'])(
    'blocks %s login for trial, archived, deleted, and revoked records',
    (role) => {
      expect(getLinkedStudentAccessBlock({ studentLifecycle: 'trial' }, role, now)).toEqual({
        reason: 'inactive_lifecycle',
      });
      expect(getLinkedStudentAccessBlock({ studentLifecycle: 'archived' }, role, now)).toEqual({
        reason: 'inactive_lifecycle',
      });
      expect(
        getLinkedStudentAccessBlock({ deletedAt: '2026-05-01T00:00:00.000Z' }, role, now)
      ).toEqual({ reason: 'revoked' });
      expect(getLinkedStudentAccessBlock({ isRevoked: true }, role, now)).toEqual({
        reason: 'revoked',
      });
    }
  );

  it('keeps the legacy boolean helper strict for generic student-parent checks', () => {
    expect(
      canStudentParentLogin({ studentLifecycle: 'enrolled', enrollmentStatus: 'active' })
    ).toBe(true);
    expect(
      canStudentParentLogin({ studentLifecycle: 'enrolled', enrollmentStatus: 'dropped' })
    ).toBe(false);
  });
});
