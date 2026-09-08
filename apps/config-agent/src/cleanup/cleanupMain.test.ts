import { describe, expect, it } from 'vitest';

import { runConfigAgentCleanupEntrypoint } from './cleanupMain.js';

describe('config-agent cleanup entrypoint telemetry', () => {
  it('binds, captures, and flushes the standalone cleanup process', async () => {
    const failure = new Error('cleanup failed');
    const order: string[] = [];
    const contexts: Array<Record<string, unknown>> = [];

    await expect(
      runConfigAgentCleanupEntrypoint({
        telemetry: {
          captureException: (error, context) => {
            expect(error).toBe(failure);
            contexts.push(context);
            order.push('capture');
            return 'EVT_00000000000000000000000022';
          },
          flush: async () => {
            order.push('flush');
          },
          healthy: () => true
        },
        run: async () => {
          throw failure;
        }
      })
    ).rejects.toBe(failure);

    expect(order).toEqual(['capture', 'flush']);
    expect(contexts).toEqual([
      expect.objectContaining({
        code: 'CONFIG_AGENT_CLEANUP_FAILED',
        source: 'job',
        level: 'fatal'
      })
    ]);
  });
});
