import { describe, expect, it } from 'vitest';

import { readProcessorPollInterval } from './processorConfig.js';

describe('readProcessorPollInterval', () => {
  it('uses a bounded 250ms idle poll by default', () => {
    expect(readProcessorPollInterval({})).toBe(250);
  });

  it('accepts an explicitly bounded worker poll interval', () => {
    expect(readProcessorPollInterval({ OPS_PROCESSOR_POLL_MS: '1000' })).toBe(1000);
  });

  it('rejects an interval that could hot-loop or conceal a backlog for too long', () => {
    for (const value of ['0', '49', '5001', '250ms', '']) {
      expect(() => readProcessorPollInterval({ OPS_PROCESSOR_POLL_MS: value })).toThrow(/poll/i);
    }
  });
});
