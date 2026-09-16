import { describe, expect, it } from 'vitest';

import { readProcessorMaxAttempts, readProcessorPollInterval } from './processorConfig.js';

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

describe('readProcessorMaxAttempts', () => {
  it('uses ten attempts by default', () => {
    expect(readProcessorMaxAttempts({})).toBe(10);
  });

  it('accepts a bounded retry limit', () => {
    expect(readProcessorMaxAttempts({ OPS_PROCESSOR_MAX_ATTEMPTS: '25' })).toBe(25);
  });

  it('rejects retry limits outside the safe range', () => {
    for (const value of ['0', '101', '10.5', 'attempts', '']) {
      expect(() => readProcessorMaxAttempts({ OPS_PROCESSOR_MAX_ATTEMPTS: value })).toThrow(
        /attempt/i
      );
    }
  });
});
