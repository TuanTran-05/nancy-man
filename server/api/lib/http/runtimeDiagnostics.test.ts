import { describe, expect, it } from 'vitest';
import { createRuntimeInvocationTracker } from './runtimeDiagnostics.js';

describe('createRuntimeInvocationTracker', () => {
  it('marks only the first request in an instance as a cold start', () => {
    const tracker = createRuntimeInvocationTracker(1_000);

    expect(tracker.record(1_025, 'hkg1')).toEqual({
      coldStart: true,
      invocation: 1,
      instanceAgeMs: 25,
      region: 'hkg1',
    });
    expect(tracker.record(1_100, 'hkg1')).toEqual({
      coldStart: false,
      invocation: 2,
      instanceAgeMs: 100,
      region: 'hkg1',
    });
  });
});
