import { describe, expect, it } from 'vitest';

import { runFailsafeEntrypoint } from './failsafe-main.js';

describe('collector failsafe entrypoint telemetry', () => {
  it('binds, captures, and flushes the standalone failsafe process', async () => {
    const failure = new Error('failsafe notification failed');
    const order: string[] = [];
    const contexts: Array<Record<string, unknown>> = [];

    await expect(
      runFailsafeEntrypoint({
        telemetry: {
          captureException: (error, context) => {
            expect(error).toBe(failure);
            contexts.push(context);
            order.push('capture');
            return 'EVT_00000000000000000000000025';
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
        code: 'OPS_FAILSAFE_FAILED',
        source: 'provider',
        level: 'fatal'
      })
    ]);
  });
});
