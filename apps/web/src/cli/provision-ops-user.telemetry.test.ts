import { describe, expect, it } from 'vitest';

import { runProvisionOpsUserEntrypoint } from './provision-ops-user.js';

describe('provision Ops user entrypoint telemetry', () => {
  it('binds, captures, and flushes the standalone provisioning process', async () => {
    const failure = new Error('provisioning failed');
    const order: string[] = [];
    const contexts: Array<Record<string, unknown>> = [];

    await expect(
      runProvisionOpsUserEntrypoint({
        telemetry: {
          captureException: (error, context) => {
            expect(error).toBe(failure);
            contexts.push(context);
            order.push('capture');
            return 'EVT_00000000000000000000000023';
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
        code: 'OPS_USER_PROVISION_FAILED',
        source: 'database',
        level: 'fatal'
      })
    ]);
  });
});
