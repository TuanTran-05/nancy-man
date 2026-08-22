import { describe, expect, it } from 'vitest';
import { shouldInitializeEnrollmentDate } from './enrollmentDate';

describe('shouldInitializeEnrollmentDate', () => {
  it('initializes a missing enrollment date', () => {
    expect(shouldInitializeEnrollmentDate({ studentLifecycle: 'trial' })).toBe(true);
  });

  it('replaces a legacy date that was written when the first trial started', () => {
    expect(
      shouldInitializeEnrollmentDate({
        studentLifecycle: 'trial',
        enrollmentDate: '2026-05-01T00:00:05.000Z',
        trialStartedAt: '2026-05-01T00:00:00.000Z',
        createdAt: '2026-05-01T00:00:02.000Z',
      })
    ).toBe(true);
  });

  it('preserves the original date for a previously enrolled returning student', () => {
    expect(
      shouldInitializeEnrollmentDate({
        studentLifecycle: 'trial',
        enrollmentDate: '2024-09-01T00:00:00.000Z',
        trialStartedAt: '2026-05-01T00:00:00.000Z',
        createdAt: '2024-09-01T00:00:00.000Z',
      })
    ).toBe(false);
  });

  it('replaces a polluted date from a rejected trial', () => {
    expect(
      shouldInitializeEnrollmentDate({
        studentLifecycle: 'trial',
        archiveReason: 'trial_rejected',
        enrollmentDate: '2026-05-01T00:00:00.000Z',
      })
    ).toBe(true);
  });
});
