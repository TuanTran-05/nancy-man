import { describe, expect, it } from 'vitest';
import { DatabaseExplorerService } from './databaseExplorerService.js';
import type { DatabaseExplorerAudit, DatabaseExplorerWorker } from './databaseExplorerService.js';
import type { SqlWorkerActor } from '../../../../../packages/contracts/src/workerProtocol.js';
import type { StepUpService } from '../auth/stepUpService.js';

describe('DatabaseExplorerService', () => {
  const maintainerActor: SqlWorkerActor = {
    userId: 'u1',
    sessionId: 's1',
    role: 'ops_maintainer'
  };

  const viewerActor: SqlWorkerActor = {
    userId: 'u2',
    sessionId: 's2',
    role: 'ops_viewer'
  };

  const mockContext = {
    requestId: 'req_123',
    ipHash: 'a'.repeat(64),
    userAgentHash: 'b'.repeat(64)
  };

  function createService(
    options: {
      workerOk?: boolean;
      workerResult?: unknown;
      workerErrorCode?: string;
      auditFail?: boolean;
      auditFailAction?: string;
      stepUpAuthorizeOk?: boolean;
      revokeFail?: boolean;
      workerCommand?: DatabaseExplorerWorker['command'];
      workerResultByKind?: Partial<
        Record<
          'database.targets' | 'database.schema' | 'database.rows' | 'database.relatedRows',
          unknown
        >
      >;
      now?: () => Date;
    } = {}
  ) {
    const auditEntries: Array<{ action: string; metadata: Record<string, unknown> }> = [];
    const auditCalls: Array<{ action: string; metadata: Record<string, unknown> }> = [];
    const stepUpBindings: unknown[] = [];
    let revokeCalls = 0;
    const schemaChecksum = 'c'.repeat(64);

    const worker: DatabaseExplorerWorker = {
      command:
        options.workerCommand ??
        (async ({ kind, payload }) => {
          if (options.workerOk === false) {
            return {
              protocolVersion: 1,
              commandId: 'c1',
              ok: false,
              error: { code: options.workerErrorCode ?? 'DATABASE_TARGET_UNAVAILABLE' }
            };
          }
          return {
            protocolVersion: 1,
            commandId: 'c1',
            ok: true,
            result:
              options.workerResultByKind?.[kind] ??
              options.workerResult ??
              (kind === 'database.targets'
                ? [
                    {
                      id: 'edutrack_production',
                      label: 'EduTrack Production',
                      status: 'available',
                      readOnly: true
                    },
                    { id: 'ops', label: 'Ops Database', status: 'disabled', readOnly: true }
                  ]
                : kind === 'database.schema'
                  ? {
                      targetId: 'edutrack_production',
                      targetLabel: 'EduTrack Production',
                      checksum: schemaChecksum,
                      policyVersion: '2026-09-25',
                      schemas: [],
                      edges: []
                    }
                  : {
                      targetId: 'edutrack_production',
                      schemaChecksum,
                      policyVersion: '2026-09-25',
                      schema: 'public',
                      relation: 'students',
                      columns: [],
                      rows: [],
                      nextCursor: null,
                      truncated: false,
                      encodedBytes: 100,
                      consistency: 'stable',
                      piiMode:
                        kind === 'database.rows' || kind === 'database.relatedRows'
                          ? ((payload as Record<string, unknown>)['piiMode'] as
                              | 'masked'
                              | 'revealed')
                          : 'masked'
                    })
          };
        })
    };

    const audit: DatabaseExplorerAudit = {
      append: async (input) => {
        auditCalls.push({ action: input.action, metadata: input.metadata });
        if (options.auditFail || options.auditFailAction === input.action) {
          throw new Error('Audit ledger unreachable');
        }
        auditEntries.push({ action: input.action, metadata: input.metadata });
        return { id: 'audit_id', entryHash: 'hash' };
      }
    };

    const stepUp = {
      authorizeDatabasePii: async (input: unknown) => {
        stepUpBindings.push(input);
        if (options.stepUpAuthorizeOk === false) {
          throw new Error('STEP_UP_INVALID');
        }
        return {
          id: 'grant_1',
          capability: 'database_pii',
          subjectDigest: 'd'.repeat(64),
          expiresAt: '2026-09-25T12:10:00.000Z'
        };
      },
      revokeDatabasePii: async () => {
        revokeCalls++;
        if (options.revokeFail) throw new Error('revoke unavailable');
        return 1;
      },
      revokeSession: async () => undefined,
      grant: async () => ({
        id: 'grant_1',
        capability: 'database_pii',
        subjectDigest: 'd'.repeat(64),
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      }),
      revoke: async () => undefined
    } as unknown as StepUpService;

    const service = new DatabaseExplorerService({
      worker,
      audit,
      stepUp,
      findUserTotpFactorId: async () => 'factor_totp_1',
      now: options.now
    } as never);

    return {
      service,
      auditEntries,
      auditCalls,
      stepUpBindings,
      getRevokeCalls: () => revokeCalls
    };
  }

  it('rejects viewer row queries with 403 DATABASE_DATA_PERMISSION_DENIED without calling worker', async () => {
    let workerCalled = false;
    const { service } = createService({
      workerCommand: async () => {
        workerCalled = true;
        return { protocolVersion: 1, commandId: 'c1', ok: true, result: {} };
      }
    });

    await expect(
      service.queryRows({
        actor: viewerActor,
        targetId: 'edutrack_production',
        query: {
          schema: 'public',
          relation: 'students',
          pageSize: 25,
          filters: [],
          piiMode: 'masked'
        },
        ...mockContext
      })
    ).rejects.toMatchObject({
      code: 'DATABASE_DATA_PERMISSION_DENIED',
      status: 403
    });

    expect(workerCalled).toBe(false);
  });

  it('allows maintainer row queries in masked mode and records audit event', async () => {
    const { service, auditEntries } = createService();

    const response = await service.queryRows({
      actor: maintainerActor,
      targetId: 'edutrack_production',
      query: {
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      },
      ...mockContext
    });

    expect(response).toBeDefined();
    expect(auditEntries).toContainEqual(
      expect.objectContaining({ action: 'database.rows_viewed' })
    );
  });

  it('requires step-up grant in revealed mode and records both row and pii audit events', async () => {
    let workerCalled = false;
    const unauthorized = createService({
      stepUpAuthorizeOk: false,
      workerCommand: async () => {
        workerCalled = true;
        return { protocolVersion: 1, commandId: 'c1', ok: true, result: {} };
      }
    });

    await expect(
      unauthorized.service.queryRows({
        actor: maintainerActor,
        targetId: 'edutrack_production',
        query: {
          schema: 'public',
          relation: 'students',
          pageSize: 25,
          filters: [],
          piiMode: 'revealed'
        },
        ...mockContext
      })
    ).rejects.toMatchObject({
      code: 'DATABASE_PII_REVEAL_REQUIRED',
      status: 403
    });
    expect(workerCalled).toBe(false);

    const { service, auditEntries, auditCalls, stepUpBindings } = createService();

    const response = await service.queryRows({
      actor: maintainerActor,
      targetId: 'edutrack_production',
      query: {
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'revealed'
      },
      ...mockContext
    });

    expect(response).toBeDefined();
    expect(auditEntries).toContainEqual(
      expect.objectContaining({ action: 'database.rows_viewed' })
    );
    expect(auditEntries).toContainEqual(
      expect.objectContaining({ action: 'database.pii_rows_viewed' })
    );
    expect(
      auditCalls.find((entry) => entry.action === 'database.pii_rows_viewed')?.metadata
    ).toHaveProperty('schemaChecksum', 'c'.repeat(64));
    expect(stepUpBindings).toEqual([
      {
        capability: 'database_pii',
        userId: maintainerActor.userId,
        sessionId: maintainerActor.sessionId,
        ipHash: mockContext.ipHash,
        userAgentHash: mockContext.userAgentHash,
        subjectDigest: '0ac718e0e47b7223dd6b64619b9c468a63b6b50ea46b35b1a2c3420800755d43'
      }
    ]);
  });

  it('projects target state from database.targets and rejects malformed target results', async () => {
    const { service } = createService();
    await expect(
      (service.getTargets as (actor: SqlWorkerActor) => Promise<unknown>)(maintainerActor)
    ).resolves.toMatchObject({
      targets: [
        { id: 'edutrack_production', status: 'available' },
        { id: 'ops', status: 'disabled' }
      ]
    });

    const malformed = createService({
      workerResultByKind: { 'database.targets': [{ id: 'ops', status: 'available' }] }
    });
    await expect(
      (malformed.service.getTargets as (actor: SqlWorkerActor) => Promise<unknown>)(maintainerActor)
    ).rejects.toMatchObject({
      code: 'WORKER_DATABASE_RESPONSE_INVALID',
      status: 503
    });
  });

  it('rejects malformed schema, rows, and related-row worker results without exposing their body', async () => {
    const { service } = createService({ workerResult: { workerSecret: 'do not expose' } });
    await expect(
      service.getSchema({ actor: maintainerActor, targetId: 'edutrack_production' })
    ).rejects.toMatchObject({ code: 'WORKER_DATABASE_RESPONSE_INVALID', status: 503 });
    await expect(
      service.queryRows({
        actor: maintainerActor,
        targetId: 'edutrack_production',
        query: {
          schema: 'public',
          relation: 'students',
          pageSize: 25,
          filters: [],
          piiMode: 'masked'
        },
        ...mockContext
      })
    ).rejects.toMatchObject({ code: 'WORKER_DATABASE_RESPONSE_INVALID', status: 503 });
    await expect(
      service.queryRelatedRows({
        actor: maintainerActor,
        targetId: 'edutrack_production',
        query: {
          schema: 'public',
          relation: 'students',
          constraint: 'students_school_fk',
          rowRef: 'opaque-row-ref',
          pageSize: 25,
          piiMode: 'masked'
        },
        ...mockContext
      })
    ).rejects.toMatchObject({ code: 'WORKER_DATABASE_RESPONSE_INVALID', status: 503 });
  });

  it('fails closed if schema audit limiter state is unavailable', async () => {
    const schemaViewAuditLimiter = {
      run: async () => {
        throw new Error('limiter persistence unavailable');
      }
    };
    const serviceWithUnavailableLimiter = new DatabaseExplorerService({
      worker: {
        command: async () => ({
          protocolVersion: 1,
          commandId: 'c1',
          ok: true,
          result: {
            targetId: 'edutrack_production',
            targetLabel: 'EduTrack Production',
            checksum: 'c'.repeat(64),
            policyVersion: '2026-09-25',
            schemas: [],
            edges: []
          }
        })
      },
      audit: { append: async () => ({ id: 'audit_id', entryHash: 'hash' }) },
      stepUp: {} as StepUpService,
      findUserTotpFactorId: async () => null,
      schemaViewAuditLimiter: schemaViewAuditLimiter as never
    });

    await expect(
      serviceWithUnavailableLimiter.getSchema({
        actor: maintainerActor,
        targetId: 'edutrack_production'
      })
    ).rejects.toMatchObject({ code: 'DATABASE_AUDIT_UNAVAILABLE', status: 503 });
  });

  it('fails closed when audit ledger append throws an error', async () => {
    const { service } = createService({ auditFail: true });

    await expect(
      service.queryRows({
        actor: maintainerActor,
        targetId: 'edutrack_production',
        query: {
          schema: 'public',
          relation: 'students',
          pageSize: 25,
          filters: [],
          piiMode: 'masked'
        },
        ...mockContext
      })
    ).rejects.toMatchObject({
      code: 'DATABASE_AUDIT_UNAVAILABLE',
      status: 503
    });
  });

  it('issues PII reveal grant and revokes on demand', async () => {
    const { service, auditEntries } = createService();

    const revealResult = await service.revealPii({
      actor: maintainerActor,
      targetId: 'edutrack_production',
      body: {
        password: 'valid_password',
        token: '123456',
        reason: 'Investigating student complaint on billing'
      },
      ...mockContext
    });

    expect(revealResult).toEqual({ expiresAt: expect.any(String) });
    expect(auditEntries).toContainEqual(
      expect.objectContaining({ action: 'database.pii_reveal_granted' })
    );

    await service.revokePiiReveal({
      actor: maintainerActor,
      targetId: 'edutrack_production',
      grantId: 'grant_1',
      ...mockContext
    });

    expect(auditEntries).toContainEqual(
      expect.objectContaining({ action: 'database.pii_reveal_revoked' })
    );
  });

  it('revokes a newly created PII grant if grant audit persistence fails', async () => {
    const service = createService({ auditFailAction: 'database.pii_reveal_granted' });
    await expect(
      service.service.revealPii({
        actor: maintainerActor,
        targetId: 'edutrack_production',
        body: {
          password: 'valid_password',
          token: '123456',
          reason: 'Investigating student complaint on billing'
        },
        ...mockContext
      })
    ).rejects.toMatchObject({ code: 'DATABASE_AUDIT_UNAVAILABLE', status: 503 });
    expect(service.getRevokeCalls()).toBe(1);
  });

  it('does not report global PII revocation success when revoke or its audit fails', async () => {
    const revokedFailure = createService({ revokeFail: true });
    await expect(
      revokedFailure.service.revokePiiReveal({ actor: maintainerActor, ...mockContext })
    ).rejects.toMatchObject({ code: 'DATABASE_REVOKE_UNAVAILABLE', status: 503 });
    expect(revokedFailure.getRevokeCalls()).toBe(1);

    const auditFailure = createService({ auditFailAction: 'database.pii_reveal_revoked' });
    await expect(
      auditFailure.service.revokePiiReveal({ actor: maintainerActor, ...mockContext })
    ).rejects.toMatchObject({ code: 'DATABASE_AUDIT_UNAVAILABLE', status: 503 });
  });
});
