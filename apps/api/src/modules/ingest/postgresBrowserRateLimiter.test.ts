import { describe, expect, it } from 'vitest';

import { PostgresBrowserRateLimiter } from './postgresBrowserRateLimiter.js';

type Counter = { count: number; limit: number };

function createDatabase() {
  const counters = new Map<string, Counter>();
  const valuesWritten: unknown[] = [];

  return {
    valuesWritten,
    query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
      if (!sql.includes('INSERT INTO ingest_rate_limits')) {
        throw new Error(`Unexpected query: ${sql}`);
      }
      const [windowStart, clientId, dimension, valueHash, limit] = parameters;
      const key = [
        (windowStart as Date).toISOString(),
        String(clientId),
        String(dimension),
        String(valueHash)
      ].join(':');
      valuesWritten.push(valueHash);
      const counter = counters.get(key) ?? { count: 0, limit: Number(limit) };
      if (counter.count >= counter.limit) return { rows: [] as T[] };
      counter.count += 1;
      counters.set(key, counter);
      return { rows: [{ requestCount: counter.count }] as T[] };
    }
  };
}

describe('PostgresBrowserRateLimiter', () => {
  it('blocks a browser session after 60 accepted events in one minute even when fingerprints vary', async () => {
    const database = createDatabase();
    const limiter = new PostgresBrowserRateLimiter({
      database,
      pepper: 'rate-limit-pepper',
      now: () => new Date('2026-08-22T10:00:42.000Z')
    });

    for (let index = 0; index < 60; index += 1) {
      await expect(
        limiter.allow({
          clientId: 'a6e29f97-e6d4-4c52-a3e1-c0f75b3ad922',
          clientIp: '203.0.113.44',
          sessionHash: 'session-abc',
          fingerprint: `fingerprint-${index}`
        })
      ).resolves.toBe(true);
    }

    await expect(
      limiter.allow({
        clientId: 'a6e29f97-e6d4-4c52-a3e1-c0f75b3ad922',
        clientIp: '203.0.113.44',
        sessionHash: 'session-abc',
        fingerprint: 'fingerprint-over-limit'
      })
    ).resolves.toBe(false);
  });

  it('limits an unauthenticated client IP at 120 events per minute', async () => {
    const database = createDatabase();
    const limiter = new PostgresBrowserRateLimiter({
      database,
      pepper: 'rate-limit-pepper',
      now: () => new Date('2026-08-22T10:00:42.000Z')
    });

    for (let index = 0; index < 120; index += 1) {
      await expect(
        limiter.allow({
          clientId: 'a6e29f97-e6d4-4c52-a3e1-c0f75b3ad922',
          clientIp: '203.0.113.44',
          fingerprint: `fingerprint-${index}`
        })
      ).resolves.toBe(true);
    }

    await expect(
      limiter.allow({
        clientId: 'a6e29f97-e6d4-4c52-a3e1-c0f75b3ad922',
        clientIp: '203.0.113.44',
        fingerprint: 'fingerprint-over-limit'
      })
    ).resolves.toBe(false);
  });

  it('persists keyed digests rather than a raw IP, session hash, or fingerprint', async () => {
    const database = createDatabase();
    const limiter = new PostgresBrowserRateLimiter({
      database,
      pepper: 'rate-limit-pepper',
      now: () => new Date('2026-08-22T10:00:42.000Z')
    });

    await limiter.allow({
      clientId: 'a6e29f97-e6d4-4c52-a3e1-c0f75b3ad922',
      clientIp: '203.0.113.44',
      sessionHash: 'session-abc',
      fingerprint: 'fingerprint-abc'
    });

    expect(database.valuesWritten).toHaveLength(3);
    expect(database.valuesWritten).not.toContain('203.0.113.44');
    expect(database.valuesWritten).not.toContain('session-abc');
    expect(database.valuesWritten).not.toContain('fingerprint-abc');
    expect(database.valuesWritten.every((value) => /^[a-f0-9]{64}$/.test(String(value)))).toBe(
      true
    );
  });
});
