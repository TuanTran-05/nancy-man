import { describe, expect, it } from 'vitest';

import { OpsUserRepository } from './opsUsers.js';

describe('OpsUserRepository', () => {
  it('looks up an account with a parameterized case-insensitive identifier', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const repository = new OpsUserRepository({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        return {
          rows: [
            {
              id: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
              username: 'ops.owner',
              email: 'owner@example.test',
              displayName: 'Ops Owner',
              role: 'ops_owner',
              status: 'active'
            }
          ] as T[]
        };
      }
    });

    const user = await repository.findByIdentifier('OPS.OWNER');

    expect(user).toMatchObject({ username: 'ops.owner', role: 'ops_owner' });
    expect(calls).toEqual([
      expect.objectContaining({
        sql: expect.stringContaining('lower(username) = lower($1)'),
        parameters: ['OPS.OWNER']
      })
    ]);
  });
});
