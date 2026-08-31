import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ConfigMetadataError,
  PostgresConfigChangeRepository,
  configDigest,
  configFingerprint,
  type ConfigChangeCreateInput,
  type ConfigChangeDatabase,
  type ConfigChangeItem,
  type ImpactPlan
} from './postgresConfigChangeRepository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const changeId = '33333333-3333-4333-8333-333333333333';
const fingerprint = configFingerprint('hmac-sha256:v1:' + 'a'.repeat(64));
const digest = configDigest('hmac-sha256:v1:' + 'b'.repeat(64));

const impactPlan: ImpactPlan = {
  applicationId: 'platform',
  sourceIds: ['platform.env'],
  actionIds: ['platform.reload'],
  checkIds: ['platform.ready'],
  strategies: ['runtime_restart'],
  counts: { items: 1, sets: 1, deletes: 0, sources: 1 },
  warnings: ['restart required'],
  expectedEffect: 'runtime_restart'
};

type QueryCall = { sql: string; parameters: readonly unknown[] };

function database(calls: QueryCall[]): ConfigChangeDatabase {
  const base = {
    query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql.includes('FROM ops_config_changes')) {
        return {
          rows: [
            {
              id: changeId,
              supersedesChangeId: null,
              actorUserId: userId,
              actorSessionId: sessionId,
              applicationId: 'platform',
              state: 'SAVED',
              reason: 'rotate endpoint',
              changeDigest: digest,
              catalogVersion: '2026-08-31',
              manifestVersion: '2026-08-31',
              keyVersion: 'v1',
              impactPlan,
              agentEnvelopeId: null,
              expiresAt: '2026-09-01T00:00:00.000Z',
              createdAt: '2026-08-31T00:00:00.000Z',
              updatedAt: '2026-08-31T00:00:00.000Z',
              version: 4
            }
          ] as T[]
        };
      }
      if (sql.includes('UPDATE ops_config_changes')) return { rows: [{ id: changeId }] as T[] };
      if (sql.includes('INSERT INTO ops_config_changes')) {
        return {
          rows: [
            {
              id: changeId,
              supersedesChangeId: null,
              actorUserId: userId,
              actorSessionId: sessionId,
              applicationId: 'platform',
              state: 'DRAFT',
              reason: 'rotate endpoint',
              changeDigest: null,
              catalogVersion: '2026-08-31',
              manifestVersion: '2026-08-31',
              keyVersion: 'v1',
              impactPlan,
              agentEnvelopeId: null,
              expiresAt: '2026-09-01T00:00:00.000Z',
              createdAt: '2026-08-31T00:00:00.000Z',
              updatedAt: '2026-08-31T00:00:00.000Z',
              version: 0
            }
          ] as T[]
        };
      }
      return { rows: [] as T[] };
    }
  };
  return {
    ...base,
    transaction: async <T>(operation: (database: typeof base) => Promise<T>) => operation(base)
  };
}

describe('Postgres config change repository', () => {
  it('accepts only branded fingerprints/digests and sends value-free parameters', async () => {
    expectTypeOf<ConfigChangeCreateInput>().not.toHaveProperty('value');
    expectTypeOf<ConfigChangeCreateInput>().not.toHaveProperty('secret');
    expectTypeOf<ConfigChangeItem>().not.toHaveProperty('value');

    const calls: QueryCall[] = [];
    const repository = new PostgresConfigChangeRepository(database(calls));
    const created = await repository.createChange({
      id: changeId,
      actorUserId: userId,
      actorSessionId: sessionId,
      applicationId: 'platform',
      reason: 'rotate endpoint',
      catalogVersion: '2026-08-31',
      manifestVersion: '2026-08-31',
      keyVersion: 'v1',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      impactPlan
    });
    expect(created).toMatchObject({ id: changeId, state: 'DRAFT', version: 0 });
    await repository.replaceItems(changeId, [
      {
        catalogId: 'platform.endpoint',
        sourceId: 'platform.env',
        operation: 'set',
        requirement: 'required',
        strategy: 'runtime_restart',
        oldValueFingerprint: fingerprint,
        newValueFingerprint: digest,
        observedSourceFingerprint: fingerprint
      }
    ]);
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain('synthetic-secret');
    expect(serialized).not.toMatch(/\b(?:value|secret|plaintext|password|totp)\b/iu);
    expect(calls.some((call) => call.sql.includes('INSERT INTO ops_config_changes'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('INSERT INTO ops_config_change_items'))).toBe(
      true
    );
  });

  it('rejects value-bearing or unbounded impact metadata before any SQL is sent', async () => {
    const calls: QueryCall[] = [];
    const repository = new PostgresConfigChangeRepository(database(calls));
    await expect(
      repository.createChange({
        id: changeId,
        actorUserId: userId,
        actorSessionId: sessionId,
        applicationId: 'platform',
        reason: 'rotate endpoint',
        catalogVersion: '2026-08-31',
        manifestVersion: '2026-08-31',
        keyVersion: 'v1',
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
        impactPlan: { ...impactPlan, warnings: ['synthetic-secret'] },
        value: 'synthetic-secret'
      } as never)
    ).rejects.toBeInstanceOf(ConfigMetadataError);
    expect(calls).toHaveLength(0);
  });

  it('uses a transaction, optimistic version predicate, idempotent IDs, and an application advisory lock', async () => {
    const calls: QueryCall[] = [];
    const base = database(calls);
    const repository = new PostgresConfigChangeRepository({
      ...base,
      transaction: async <T>(operation: (database: typeof base) => Promise<T>) => operation(base)
    });
    const result = await repository.transition({
      changeId,
      applicationId: 'platform',
      transitionId: '44444444-4444-4444-8444-444444444444',
      eventId: '55555555-5555-4555-8555-555555555555',
      runId: '66666666-6666-4666-8666-666666666666',
      actorUserId: userId,
      actorSessionId: sessionId,
      expectedVersion: 4,
      to: 'APPLYING'
    });
    expect(result.state).toBe('APPLYING');
    expect(calls[0]?.sql).toContain('pg_advisory_xact_lock');
    expect(calls.some((call) => call.sql.includes('FOR UPDATE'))).toBe(true);
    const update = calls.find((call) => call.sql.includes('UPDATE ops_config_changes'));
    expect(update?.sql).toContain('version = $');
    expect(update?.sql).toContain('AND version = $');
    expect(calls.some((call) => call.sql.includes('INSERT INTO ops_config_runs'))).toBe(true);
  });

  it('does not allow a blocked application to begin another apply', async () => {
    const calls: QueryCall[] = [];
    const base = database(calls);
    const repository = new PostgresConfigChangeRepository({
      ...base,
      transaction: async <T>(operation: (database: typeof base) => Promise<T>) =>
        operation({
          ...base,
          query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
            calls.push({ sql, parameters });
            if (sql.includes('FROM ops_config_application_blocks')) {
              return {
                rows: [{ applicationId: 'platform', reasonCode: 'ROLLBACK_FAILED' }] as T[]
              };
            }
            return base.query<T>(sql, parameters);
          }
        })
    });
    await expect(
      repository.transition({
        changeId,
        applicationId: 'platform',
        transitionId: '77777777-7777-4777-8777-777777777777',
        eventId: '88888888-8888-4888-8888-888888888888',
        runId: '99999999-9999-4999-8999-999999999999',
        actorUserId: userId,
        actorSessionId: sessionId,
        expectedVersion: 4,
        to: 'APPLYING'
      })
    ).rejects.toThrow('CONFIG_APPLICATION_BLOCKED');
    expect(calls.some((call) => call.sql.includes('ops_config_application_blocks'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('UPDATE ops_config_changes'))).toBe(false);
  });

  it('serializes concurrent APPLYING starts so only one transaction can win', async () => {
    let state: 'SAVED' | 'APPLYING' = 'SAVED';
    let version = 4;
    let lockTail = Promise.resolve();
    const query = async <T>(sql: string, parameters: readonly unknown[] = []) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] as T[] };
      if (sql.includes('FROM ops_config_application_blocks')) return { rows: [] as T[] };
      if (sql.includes('FROM ops_config_changes')) {
        return {
          rows: [
            {
              id: changeId,
              supersedesChangeId: null,
              actorUserId: userId,
              actorSessionId: sessionId,
              applicationId: 'platform',
              state,
              reason: 'rotate endpoint',
              changeDigest: digest,
              catalogVersion: '2026-08-31',
              manifestVersion: '2026-08-31',
              keyVersion: 'v1',
              impactPlan,
              agentEnvelopeId: null,
              expiresAt: '2026-09-01T00:00:00.000Z',
              createdAt: '2026-08-31T00:00:00.000Z',
              updatedAt: '2026-08-31T00:00:00.000Z',
              version
            }
          ] as T[]
        };
      }
      if (sql.includes('FROM ops_config_runs')) return { rows: [] as T[] };
      if (sql.includes('UPDATE ops_config_changes')) {
        const expectedState = parameters[4];
        const expectedVersion = parameters[5];
        if (state !== expectedState || version !== expectedVersion) return { rows: [] as T[] };
        state = 'APPLYING';
        version += 1;
        return { rows: [{ id: changeId }] as T[] };
      }
      return { rows: [] as T[] };
    };
    const database: ConfigChangeDatabase = {
      query,
      transaction: async <T>(operation: (database: ConfigChangeDatabase) => Promise<T>) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await operation(database);
        } finally {
          release();
        }
      }
    };
    const repository = new PostgresConfigChangeRepository(database);
    const baseInput = {
      changeId,
      applicationId: 'platform',
      runId: '66666666-6666-4666-8666-666666666666',
      actorUserId: userId,
      actorSessionId: sessionId,
      expectedVersion: 4,
      to: 'APPLYING' as const
    };
    const outcomes = await Promise.allSettled([
      repository.transition({
        ...baseInput,
        transitionId: '77777777-7777-4777-8777-777777777777',
        eventId: '88888888-8888-4888-8888-888888888888'
      }),
      repository.transition({
        ...baseInput,
        transitionId: '99999999-9999-4999-8999-999999999999',
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      })
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });
});
