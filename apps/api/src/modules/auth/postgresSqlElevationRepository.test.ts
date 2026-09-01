import { describe, expect, it } from 'vitest';

import { PostgresSqlElevationRepository } from './postgresSqlElevationRepository.js';

describe('PostgresSqlElevationRepository', () => {
  it('returns the stored UTF-8 TOTP envelope for SQL elevation verification', async () => {
    let statement = '';
    const repository = new PostgresSqlElevationRepository({
      query: async <T>(sql: string) => {
        statement = sql;
        return { rows: [{ encryptedSecret: 'v1.iv.ciphertext.tag' }] as T[] };
      }
    });

    await expect(
      repository.findActiveTotpFactor({ userId: 'user-id', factorId: 'factor-id' })
    ).resolves.toEqual({ encryptedSecret: 'v1.iv.ciphertext.tag' });
    expect(statement).toContain("convert_from(factor.encrypted_secret, 'UTF8')");
    expect(statement).not.toContain("encode(factor.encrypted_secret, 'base64')");
  });

  it('binds factor lookup and elevation grant to the active authenticated user/session', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const repository = new PostgresSqlElevationRepository({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        if (sql.includes('convert_from(factor.encrypted_secret')) {
          return { rows: [{ encryptedSecret: 'encrypted' }] as T[] };
        }
        return { rows: [{ granted: true }] as T[] };
      }
    });

    await expect(
      repository.findActiveTotpFactor({ userId: 'user-id', factorId: 'factor-id' })
    ).resolves.toEqual({ encryptedSecret: 'encrypted' });
    await expect(
      repository.grant({
        id: 'elevation-id',
        userId: 'user-id',
        sessionId: 'session-id',
        factorId: 'factor-id',
        reason: 'Investigate database error',
        grantedAt: '2026-08-22T10:00:00.000Z',
        idleExpiresAt: '2026-08-22T10:15:00.000Z',
        absoluteExpiresAt: '2026-08-22T10:30:00.000Z'
      })
    ).resolves.toBe(true);

    const grant = calls.at(-1);
    expect(grant?.sql).toContain('INSERT INTO ops_sql_elevations');
    expect(grant?.sql).toContain('FROM ops_sessions AS session');
    expect(grant?.sql).toContain('INSERT INTO ops_elevation_events');
    expect(grant?.parameters).toEqual(
      expect.arrayContaining(['user-id', 'session-id', 'factor-id', 'Investigate database error'])
    );
  });

  it('touches only a currently active elevation and never extends its absolute expiry', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const repository = new PostgresSqlElevationRepository({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        return {
          rows: [
            {
              idleExpiresAt: '2026-08-22T10:15:00.000Z',
              absoluteExpiresAt: '2026-08-22T10:30:00.000Z'
            }
          ] as T[]
        };
      }
    });

    await expect(
      repository.consumeActive({ userId: 'user-id', sessionId: 'session-id' })
    ).resolves.toEqual({
      idleExpiresAt: '2026-08-22T10:15:00.000Z',
      absoluteExpiresAt: '2026-08-22T10:30:00.000Z'
    });
    expect(calls[0]?.sql).toContain("interval '15 minutes'");
    expect(calls[0]?.sql).toContain('absolute_expires_at > now()');
    expect(calls[0]?.sql).not.toContain('absolute_expires_at =');
  });
});
