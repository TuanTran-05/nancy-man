import { describe, expect, it } from 'vitest';

import { createEventId, createRequestId } from './ids.js';

describe('telemetry IDs', () => {
  it('creates monotonic prefixed ULID-style IDs', () => {
    const first = createEventId(1_787_356_840_000, () => Buffer.alloc(10, 1));
    const second = createEventId(1_787_356_840_000, () => Buffer.alloc(10, 2));
    const requestId = createRequestId(1_787_356_840_000, () => Buffer.alloc(10, 3));

    expect(first).toMatch(/^EVT_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(second).toMatch(/^EVT_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(requestId).toMatch(/^REQ_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(first < second).toBe(true);
  });
});
