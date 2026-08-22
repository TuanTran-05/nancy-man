import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCleanupCountdown } from './AuditLog';

const t = {
  auditLogPage: {
    cleanupCountdown: 'Activity logs will be deleted in {days} days',
    cleanupInProgress: 'Activity logs are being cleaned up...',
  },
};

describe('getCleanupCountdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the cleanup warning seven days before the 13th', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T08:00:00.000Z'));

    expect(getCleanupCountdown(t)).toEqual({
      show: true,
      message: 'Activity logs will be deleted in 7 days',
      isCleanupDay: false,
    });
  });
});
