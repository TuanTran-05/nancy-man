import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSystemdWatchdog } from './systemdNotify.js';

describe('systemd watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces readiness and sends heartbeats at half the watchdog interval', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const watchdog = startSystemdWatchdog({ NOTIFY_SOCKET: '@/run/systemd/notify', WATCHDOG_USEC: '45000000' }, send);

    expect(send).toHaveBeenCalledWith('READY=1', '\0/run/systemd/notify');
    vi.advanceTimersByTime(22_500);
    expect(send).toHaveBeenCalledWith('WATCHDOG=1', '\0/run/systemd/notify');

    watchdog.stop();
    vi.advanceTimersByTime(45_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does nothing when systemd watchdog variables are absent', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const watchdog = startSystemdWatchdog({}, send);

    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
    expect(() => watchdog.stop()).not.toThrow();
  });
});
