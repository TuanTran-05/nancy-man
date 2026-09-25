import { describe, expect, it } from 'vitest';

import { PostgresStepUpRepository } from './postgresStepUpRepository.js';

describe('PostgresStepUpRepository', () => {
  it('returns the stored UTF-8 TOTP envelope for step-up verification', async () => {
    let statement = '';
    const repository = new PostgresStepUpRepository({
      query: async <T>(sql: string) => {
        statement = sql;
        return {
          rows: [
            {
              passwordHash: '$argon2id$encoded',
              encryptedTotpSecret: 'v1.iv.ciphertext.tag'
            }
          ] as T[]
        };
      }
    });

    await expect(
      repository.findProof({ userId: 'user-id', factorId: 'factor-id' })
    ).resolves.toMatchObject({ encryptedTotpSecret: 'v1.iv.ciphertext.tag' });
    expect(statement).toContain("convert_from(factor.encrypted_secret, 'UTF8')");
    expect(statement).not.toContain("encode(factor.encrypted_secret, 'base64')");
  });

  it('uses the typed elevation table and atomically consumes one-use grants', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const repository = new PostgresStepUpRepository({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        if (sql.includes('RETURNING id')) return { rows: [{ id: 'grant-id' }] as T[] };
        return { rows: [] as T[] };
      }
    });

    await repository.consume({
      grantId: 'grant-id',
      capability: 'accounts_write',
      userId: 'user-id',
      sessionId: 'session-id',
      ipHash: 'a'.repeat(64),
      userAgentHash: 'b'.repeat(64)
    });
    const sql = calls.map(({ sql: value }) => value).join('\n');
    expect(sql).toContain('ops_secret_elevations');
    expect(sql).toContain('consumed_at IS NULL');
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at > now()');
    expect(sql).not.toMatch(/password_hash|encrypted_totp|cleartext/iu);
  });

  it('marks database_pii elevations as reusable in authorize query', async () => {
    let capturedSql = '';
    const repository = new PostgresStepUpRepository({
      query: async <T>(sql: string) => {
        capturedSql = sql;
        return {
          rows: [
            {
              id: 'grant-id',
              capability: 'database_pii',
              userId: 'u1',
              sessionId: 's1',
              ipHash: 'a'.repeat(64),
              userAgentHash: 'b'.repeat(64),
              subjectDigest: 'd'.repeat(64),
              grantedAt: '2026-09-25T00:00:00Z',
              expiresAt: '2026-09-25T00:10:00Z',
              lastUsedAt: null,
              consumedAt: null,
              revokedAt: null,
              reusable: true
            }
          ] as T[]
        };
      }
    });

    const grant = await repository.authorize({
      grantId: 'grant-id',
      capability: 'database_pii',
      userId: 'u1',
      sessionId: 's1',
      ipHash: 'a'.repeat(64),
      userAgentHash: 'b'.repeat(64),
      subjectDigest: 'd'.repeat(64)
    });

    expect(capturedSql).toContain(
      "(capability IN ('variables_secret', 'database_pii')) AS reusable"
    );
    expect(grant?.reusable).toBe(true);
  });

  it('persists the reusable setting required for server-side database PII lookup', async () => {
    let capturedSql = '';
    let parameters: readonly unknown[] = [];
    const repository = new PostgresStepUpRepository({
      query: async <T>(sql: string, values: readonly unknown[] = []) => {
        capturedSql = sql;
        parameters = values;
        return { rows: [{ id: 'grant-id' }] as T[] };
      }
    });

    await repository.insert({
      id: 'grant-id',
      capability: 'database_pii',
      userId: 'user-id',
      sessionId: 'session-id',
      ipHash: 'a'.repeat(64),
      userAgentHash: 'b'.repeat(64),
      subjectDigest: 'c'.repeat(64),
      grantedAt: '2026-09-25T00:00:00Z',
      expiresAt: '2026-09-25T00:10:00Z',
      lastUsedAt: null,
      consumedAt: null,
      revokedAt: null,
      reusable: true
    });

    expect(capturedSql).toContain('reusable');
    expect(parameters.at(-1)).toBe(true);
  });

  it('looks up active database PII grants by the complete server binding without a grant ID', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const repository = new PostgresStepUpRepository({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        return {
          rows: [
            {
              id: 'grant-id',
              capability: 'database_pii',
              userId: 'user-id',
              sessionId: 'session-id',
              ipHash: 'a'.repeat(64),
              userAgentHash: 'b'.repeat(64),
              subjectDigest: 'c'.repeat(64),
              grantedAt: '2026-09-25T00:00:00Z',
              expiresAt: '2026-09-25T00:10:00Z',
              lastUsedAt: null,
              consumedAt: null,
              revokedAt: null,
              reusable: true
            }
          ] as T[]
        };
      }
    });
    const findActiveDatabasePii = (
      repository as unknown as {
        findActiveDatabasePii?: (input: {
          capability: 'database_pii';
          userId: string;
          sessionId: string;
          ipHash: string;
          userAgentHash: string;
          subjectDigest: string;
        }) => Promise<unknown>;
      }
    ).findActiveDatabasePii;

    expect(typeof findActiveDatabasePii).toBe('function');
    if (!findActiveDatabasePii) return;
    await expect(
      findActiveDatabasePii.call(repository, {
        capability: 'database_pii',
        userId: 'user-id',
        sessionId: 'session-id',
        ipHash: 'a'.repeat(64),
        userAgentHash: 'b'.repeat(64),
        subjectDigest: 'c'.repeat(64)
      })
    ).resolves.toMatchObject({ id: 'grant-id', subjectDigest: 'c'.repeat(64), reusable: true });
    expect(calls[0]?.sql).toContain('subject_digest = $6');
    expect(calls[0]?.sql).toContain('user_agent_hash = $5');
    expect(calls[0]?.parameters).toEqual([
      'database_pii',
      'user-id',
      'session-id',
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64)
    ]);
  });

  it('revokes matching database PII bindings and every session PII grant', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const repository = new PostgresStepUpRepository({
      query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        return { rows: [{ id: 'grant-id' }] as T[] };
      }
    });
    const withPiiRevokes = repository as unknown as {
      revokeDatabasePii?: (input: {
        capability: 'database_pii';
        userId: string;
        sessionId: string;
        ipHash: string;
        userAgentHash: string;
      }) => Promise<number>;
      revokeSession?: (input: { capability: 'database_pii'; sessionId: string }) => Promise<void>;
    };

    expect(typeof withPiiRevokes.revokeDatabasePii).toBe('function');
    expect(typeof withPiiRevokes.revokeSession).toBe('function');
    if (!withPiiRevokes.revokeDatabasePii || !withPiiRevokes.revokeSession) return;
    await expect(
      withPiiRevokes.revokeDatabasePii.call(repository, {
        capability: 'database_pii',
        userId: 'user-id',
        sessionId: 'session-id',
        ipHash: 'a'.repeat(64),
        userAgentHash: 'b'.repeat(64)
      })
    ).resolves.toBe(1);
    await withPiiRevokes.revokeSession.call(repository, {
      capability: 'database_pii',
      sessionId: 'session-id'
    });
    expect(calls[0]?.sql).toContain('capability = $1');
    expect(calls[0]?.sql).toContain('($6::char(64) IS NULL OR subject_digest = $6)');
    expect(calls[1]?.sql).toContain('session_id = $1');
    expect(calls[1]?.sql).toContain("capability = 'database_pii'");
  });
});
