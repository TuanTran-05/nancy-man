import { describe, expect, it } from 'vitest';

import { PostgresStepUpRepository } from '../auth/postgresStepUpRepository.js';
import { StepUpService, type StepUpGrant } from '../auth/stepUpService.js';
import type { ParameterizedDatabase } from '../../../../../packages/db/src/repositories/opsUsers.js';
import { DatabaseExplorerService } from './databaseExplorerService.js';

type PersistedGrant = StepUpGrant & { auditCompletedAt: string | null };

function createLifecycleHarness(
  input: {
    deferGrantAudit?: boolean;
    failGrantAudit?: boolean;
    failGrantRevoke?: boolean;
    failActivation?: boolean;
  } = {}
) {
  const fixedNow = new Date('2026-09-25T12:00:00.000Z');
  const grants = new Map<string, PersistedGrant>();
  let resolveAuditStarted!: () => void;
  const grantAuditStarted = new Promise<void>((resolve) => {
    resolveAuditStarted = resolve;
  });
  let releaseGrantAudit!: () => void;
  const grantAuditGate = new Promise<void>((resolve) => {
    releaseGrantAudit = resolve;
  });
  let workerCalls = 0;

  const database: ParameterizedDatabase = {
    query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
      const normalized = sql.replace(/\s+/gu, ' ').trim().toLowerCase();
      if (normalized.includes('from ops_password_credentials')) {
        return {
          rows: [
            { passwordHash: 'encoded-password', encryptedTotpSecret: 'encrypted-secret' }
          ] as T[]
        };
      }
      if (normalized.includes('from ops_sessions where id = $2')) {
        return {
          rows: [{ absoluteExpiresAt: '2026-09-25T12:30:00.000Z' }] as T[]
        };
      }
      if (
        normalized.startsWith('update ops_secret_elevations') &&
        normalized.includes('where user_id = $1 and session_id = $2')
      ) {
        return { rows: [] as T[] };
      }
      if (normalized.startsWith('insert into ops_secret_elevations')) {
        const grant: PersistedGrant = {
          id: String(parameters[0]),
          capability: 'database_pii',
          userId: String(parameters[2]),
          sessionId: String(parameters[3]),
          ipHash: String(parameters[4]),
          userAgentHash: String(parameters[5]),
          subjectDigest: String(parameters[6]),
          grantedAt: String(parameters[7]),
          expiresAt: String(parameters[8]),
          reusable: Boolean(parameters[9]),
          lastUsedAt: null,
          consumedAt: null,
          revokedAt: null,
          auditCompletedAt: null
        };
        grants.set(grant.id, grant);
        return { rows: [{ id: grant.id }] as T[] };
      }
      if (normalized.includes('set audit_completed_at = now()')) {
        if (input.failActivation) return { rows: [] as T[] };
        const grant = grants.get(String(parameters[0]));
        if (
          !grant ||
          grant.auditCompletedAt !== null ||
          grant.revokedAt !== null ||
          grant.consumedAt !== null ||
          grant.capability !== parameters[1] ||
          grant.userId !== parameters[2] ||
          grant.sessionId !== parameters[3] ||
          grant.ipHash !== parameters[4] ||
          grant.userAgentHash !== parameters[5] ||
          grant.subjectDigest !== parameters[6]
        ) {
          return { rows: [] as T[] };
        }
        grant.auditCompletedAt = fixedNow.toISOString();
        return { rows: [{ id: grant.id }] as T[] };
      }
      if (normalized.includes('set last_used_at = now()')) {
        const [capability, userId, sessionId, ipHash, userAgentHash, subjectDigest] = parameters;
        const grant = [...grants.values()].find(
          (candidate) =>
            candidate.capability === capability &&
            candidate.userId === userId &&
            candidate.sessionId === sessionId &&
            candidate.ipHash === ipHash &&
            candidate.userAgentHash === userAgentHash &&
            candidate.subjectDigest === subjectDigest &&
            candidate.reusable &&
            candidate.revokedAt === null &&
            candidate.consumedAt === null &&
            (!normalized.includes('audit_completed_at is not null') ||
              candidate.auditCompletedAt !== null)
        );
        if (!grant) return { rows: [] as T[] };
        grant.lastUsedAt = fixedNow.toISOString();
        const activeGrant = { ...grant };
        Reflect.deleteProperty(activeGrant, 'auditCompletedAt');
        return { rows: [activeGrant] as T[] };
      }
      if (
        normalized.startsWith('update ops_secret_elevations') &&
        normalized.includes('set revoked_at = now()') &&
        normalized.includes('where capability = $1 and user_id = $2')
      ) {
        if (input.failGrantRevoke) throw new Error('PII grant revoke unavailable');
        const [capability, userId, sessionId, ipHash, userAgentHash, subjectDigest] = parameters;
        const revoked: Array<{ id: string }> = [];
        for (const grant of grants.values()) {
          if (
            grant.capability === capability &&
            grant.userId === userId &&
            grant.sessionId === sessionId &&
            grant.ipHash === ipHash &&
            grant.userAgentHash === userAgentHash &&
            (subjectDigest === null || grant.subjectDigest === subjectDigest) &&
            grant.reusable &&
            grant.revokedAt === null &&
            grant.consumedAt === null
          ) {
            grant.revokedAt = fixedNow.toISOString();
            revoked.push({ id: grant.id });
          }
        }
        return { rows: revoked as T[] };
      }
      return { rows: [] as T[] };
    }
  };
  const repository = new PostgresStepUpRepository(database);
  const stepUp = new StepUpService({
    repository,
    now: () => fixedNow,
    verifyPassword: async () => true,
    verifyTotp: () => true,
    issueId: () => 'grant-1'
  });
  const service = new DatabaseExplorerService({
    worker: {
      command: async ({ payload }) => {
        workerCalls += 1;
        const query = payload as Record<string, unknown>;
        return {
          protocolVersion: 1,
          commandId: `worker-${workerCalls}`,
          ok: true,
          result: {
            targetId: query['targetId'],
            schemaChecksum: 'c'.repeat(64),
            policyVersion: 'v1',
            schema: query['schema'],
            relation: query['relation'],
            columns: [],
            rows: [],
            nextCursor: null,
            truncated: false,
            encodedBytes: 0,
            consistency: 'stable',
            piiMode: query['piiMode']
          }
        };
      }
    },
    audit: {
      append: async ({ action }) => {
        if (action === 'database.pii_reveal_granted') {
          resolveAuditStarted();
          if (input.deferGrantAudit) await grantAuditGate;
          if (input.failGrantAudit) throw new Error('audit ledger unavailable');
        }
        return { id: 'audit-id', entryHash: 'audit-hash' };
      }
    },
    stepUp,
    findUserTotpFactorId: async () => 'factor-id',
    now: () => fixedNow
  });
  const actor = { userId: 'user-1', sessionId: 'session-1', role: 'ops_maintainer' as const };
  const context = { ipHash: 'a'.repeat(64), userAgentHash: 'b'.repeat(64) };
  const reveal = () =>
    service.revealPii({
      actor,
      targetId: 'edutrack_production',
      body: { password: 'valid-password', token: '123456', reason: 'Incident triage' },
      ...context
    });
  const queryRevealed = () =>
    service.queryRows({
      actor,
      targetId: 'edutrack_production',
      query: {
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'revealed'
      },
      ...context
    });

  return {
    reveal,
    queryRevealed,
    grantAuditStarted,
    releaseGrantAudit,
    getWorkerCalls: () => workerCalls,
    grants
  };
}

describe('Database PII audited grant lifecycle', () => {
  it('denies concurrent and later revealed reads until the grant audit activates the binding', async () => {
    const harness = createLifecycleHarness({ deferGrantAudit: true });
    const pendingReveal = harness.reveal();
    await harness.grantAuditStarted;

    await expect(harness.queryRevealed()).rejects.toMatchObject({
      code: 'DATABASE_PII_REVEAL_REQUIRED',
      status: 403
    });
    expect(harness.getWorkerCalls()).toBe(0);

    harness.releaseGrantAudit();
    await expect(pendingReveal).resolves.toEqual({ expiresAt: '2026-09-25T12:10:00.000Z' });
    await expect(harness.queryRevealed()).resolves.toMatchObject({ piiMode: 'revealed' });
    expect(harness.getWorkerCalls()).toBe(1);
    expect([...harness.grants.values()][0]?.auditCompletedAt).toBe('2026-09-25T12:00:00.000Z');
  });

  it('keeps an unaudited grant unusable when audit and compensating revoke both fail', async () => {
    const harness = createLifecycleHarness({ failGrantAudit: true, failGrantRevoke: true });

    await expect(harness.reveal()).rejects.toMatchObject({
      code: 'DATABASE_AUDIT_UNAVAILABLE',
      status: 503
    });
    await expect(harness.queryRevealed()).rejects.toMatchObject({
      code: 'DATABASE_PII_REVEAL_REQUIRED',
      status: 403
    });
    expect(harness.getWorkerCalls()).toBe(0);
    expect([...harness.grants.values()][0]?.auditCompletedAt).toBeNull();
    expect([...harness.grants.values()][0]?.revokedAt).toBeNull();
  });

  it('does not return reveal success or authorize reads if activation fails after audit', async () => {
    const harness = createLifecycleHarness({ failActivation: true });

    await expect(harness.reveal()).rejects.toMatchObject({
      code: 'DATABASE_PII_GRANT_ACTIVATION_FAILED',
      status: 503
    });
    await expect(harness.queryRevealed()).rejects.toMatchObject({
      code: 'DATABASE_PII_REVEAL_REQUIRED',
      status: 403
    });
    expect(harness.getWorkerCalls()).toBe(0);
    expect([...harness.grants.values()][0]?.auditCompletedAt).toBeNull();
    expect([...harness.grants.values()][0]?.revokedAt).toBe('2026-09-25T12:00:00.000Z');
  });
});
