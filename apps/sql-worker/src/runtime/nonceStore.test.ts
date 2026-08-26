import { describe, expect, it } from 'vitest';

import { createExpiringNonceStore } from './nonceStore.js';

describe('createExpiringNonceStore', () => {
  it('accepts a nonce once and rejects its replay until it expires', () => {
    let now = 1_000;
    const store = createExpiringNonceStore({ now: () => now, timeToLiveMilliseconds: 60_000 });

    expect(store.consume('nonce-0123456789abcdef')).toBe(true);
    expect(store.consume('nonce-0123456789abcdef')).toBe(false);
    now += 60_001;
    expect(store.consume('nonce-0123456789abcdef')).toBe(true);
  });

  it('fails closed for malformed or excessive nonce values', () => {
    const store = createExpiringNonceStore({ maximumEntries: 1 });

    expect(store.consume('short')).toBe(false);
    expect(store.consume('nonce-0123456789abcdef')).toBe(true);
    expect(store.consume('nonce-fedcba9876543210')).toBe(false);
  });
});
