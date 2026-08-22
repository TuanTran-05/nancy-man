import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { OpsSessionRepository } from './opsSessions.js';

describe('OpsSessionRepository', () => {
  it('hashes the presented token with the server pepper and rate-limits activity updates', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const sessionHash = createHash('sha256').update('session-tokenpepper').digest('hex');
    const repository = new OpsSessionRepository(
      {
        query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
          calls.push({ sql, parameters });
          if (sql.includes('FROM ops_sessions')) {
            return {
              rows: [
                {
                  id: '2f25fd2f-ae51-482f-9e2c-604d3c1eecb0',
                  userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
                  sessionHash,
                  csrfSecretHash: 'b'.repeat(64),
                  role: 'ops_owner',
                  lastActivityAt: '2026-08-22T03:00:00.000Z',
                  idleExpiresAt: '2026-08-22T03:30:00.000Z',
                  absoluteExpiresAt: '2026-08-22T15:00:00.000Z'
                }
              ] as T[]
            };
          }
          return { rows: [] as T[] };
        }
      },
      'pepper',
      () => new Date('2026-08-22T03:06:00.000Z')
    );

    const session = await repository.findActiveByToken('session-token');

    expect(session?.id).toBe('2f25fd2f-ae51-482f-9e2c-604d3c1eecb0');
    expect(calls[0]).toEqual(
      expect.objectContaining({ parameters: [sessionHash, '2026-08-22T03:06:00.000Z'] })
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE ops_sessions'),
        parameters: ['2026-08-22T03:06:00.000Z', '2f25fd2f-ae51-482f-9e2c-604d3c1eecb0']
      })
    );
  });
});
