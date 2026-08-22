import { describe, expect, it } from 'vitest';

import { readNotifierPollInterval } from './notifierConfig.js';

describe('readNotifierPollInterval', () => {
  it('uses a bounded one-second dark-launch scheduler poll by default', () => {
    expect(readNotifierPollInterval({})).toBe(1000);
  });

  it('rejects an unsafe notifier poll interval', () => {
    for (const value of ['0', '249', '5001', '1 second']) {
      expect(() => readNotifierPollInterval({ OPS_NOTIFIER_POLL_MS: value })).toThrow(/poll/i);
    }
  });
});
