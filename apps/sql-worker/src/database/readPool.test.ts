import { describe, expect, it } from 'vitest';

import {
  assertProductionReadIdentity,
  assertTlsProtectedPostgresUrl,
  createReadPreviewer
} from './readPool.js';

describe('production read pool', () => {
  it('accepts only the configured read role and production database identity', async () => {
    await expect(
      assertProductionReadIdentity({
        database: {
          query: async <T>() => ({
            rows: [
              {
                role: 'ops_production_reader',
                database: 'edutrack_production',
                defaultTransactionReadOnly: 'on'
              }
            ] as T[]
          })
        },
        expectedRole: 'ops_production_reader',
        expectedDatabase: 'edutrack_production'
      })
    ).resolves.toEqual({ role: 'ops_production_reader', database: 'edutrack_production' });
  });

  it('refuses a writable default transaction or mismatched database identity', async () => {
    await expect(
      assertProductionReadIdentity({
        database: {
          query: async <T>() => ({
            rows: [
              {
                role: 'ops_production_reader',
                database: 'edutrack_production',
                defaultTransactionReadOnly: 'off'
              }
            ] as T[]
          })
        },
        expectedRole: 'ops_production_reader',
        expectedDatabase: 'edutrack_production'
      })
    ).rejects.toThrow(/read-only/i);
  });

  it('uses a single checked-out connection for a preview and releases it after rollback', async () => {
    const calls: string[] = [];
    let released = false;
    const preview = createReadPreviewer({
      pool: {
        connect: async () => ({
          query: async <T>(sql: string) => {
            calls.push(sql);
            return { rows: [{ id: 1 }, { id: 2 }] as T[] };
          },
          release: () => {
            released = true;
          }
        })
      }
    });

    await expect(preview({ sql: 'SELECT id FROM students', maxRows: 1 })).resolves.toEqual({
      rows: [{ id: 1 }],
      truncated: true
    });
    expect(calls).toContain('BEGIN READ ONLY');
    expect(calls).toContain('ROLLBACK');
    expect(released).toBe(true);
  });

  it('requires TLS verify-full in a production database URL', () => {
    expect(() =>
      assertTlsProtectedPostgresUrl(
        'postgresql://reader:password@db.internal/edutrack_production?sslmode=verify-full'
      )
    ).not.toThrow();
    expect(() =>
      assertTlsProtectedPostgresUrl('postgresql://reader:password@db.internal/edutrack_production')
    ).toThrow(/verify-full/i);
  });
});
