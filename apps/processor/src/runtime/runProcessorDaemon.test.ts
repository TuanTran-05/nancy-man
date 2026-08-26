import { describe, expect, it } from 'vitest';

import { runProcessorDaemon } from './runProcessorDaemon.js';

describe('runProcessorDaemon', () => {
  it('continues while work is available, reclaims expired claims, and sleeps only after an empty poll', async () => {
    const released: Date[] = [];
    const waits: number[] = [];
    let runs = 0;
    let checks = 0;

    await runProcessorDaemon({
      pollIntervalMs: 250,
      releaseExpiredClaims: async (now) => {
        released.push(now);
      },
      runOnce: async () => {
        runs += 1;
        return runs === 1 ? { processed: true } : { processed: false };
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
      shouldStop: () => {
        checks += 1;
        return checks > 2;
      },
      now: () => new Date('2026-08-22T10:00:00.000Z')
    });

    expect(runs).toBe(2);
    expect(released).toEqual([new Date('2026-08-22T10:00:00.000Z')]);
    expect(waits).toEqual([250]);
  });

  it('backs off after a retryable processing failure instead of hot-looping', async () => {
    const waits: number[] = [];
    let checks = 0;

    await runProcessorDaemon({
      pollIntervalMs: 250,
      releaseExpiredClaims: async () => undefined,
      runOnce: async () => ({ processed: false, retried: true }),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
      shouldStop: () => {
        checks += 1;
        return checks > 1;
      }
    });

    expect(waits).toEqual([250]);
  });
});
