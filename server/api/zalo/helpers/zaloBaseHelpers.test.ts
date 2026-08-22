import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadHelpers(options: {
  add?: () => Promise<unknown>;
  markRecord?: () => Promise<void>;
}) {
  vi.resetModules();
  vi.doMock('../../lib/auth/verifyAuth.js', () => ({
    getDb: () => ({
      collection: () => ({
        add: options.add || vi.fn().mockResolvedValue({ id: 'log-1' }),
      }),
    }),
  }));
  vi.doMock('../../lib/auth/rateLimit.js', () => ({
    checkRateLimit: vi.fn(),
    isDuplicateWithinWindow: vi.fn(),
    markRecord: options.markRecord || vi.fn().mockResolvedValue(undefined),
  }));
  return import('./zaloBaseHelpers.js');
}

describe('zaloBaseHelpers tracking writes', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not let notification log writes hang the caller', async () => {
    vi.useFakeTimers();
    const { logZaloNotification, ZALO_TRACKING_WRITE_TIMEOUT_MS } = await loadHelpers({
      add: () => new Promise(() => {}),
    });

    let settled = false;
    const promise = logZaloNotification({ studentId: 'student-1', type: 'tuition_notice' }).then(
      () => {
        settled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(ZALO_TRACKING_WRITE_TIMEOUT_MS + 1);
    await promise;

    expect(settled).toBe(true);
  });

  it('does not let dedup tracking writes hang the caller', async () => {
    vi.useFakeTimers();
    const { markZaloSendRecord, ZALO_TRACKING_WRITE_TIMEOUT_MS } = await loadHelpers({
      markRecord: () => new Promise(() => {}),
    });

    let settled = false;
    const promise = markZaloSendRecord({} as any, 'notify-tuition-notice', 'student-1').then(
      () => {
        settled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(ZALO_TRACKING_WRITE_TIMEOUT_MS + 1);
    await promise;

    expect(settled).toBe(true);
  });
});
