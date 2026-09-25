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
      stepUpAuthorizeOk?: boolean;
    } = {}
  ) {
    const auditEntries: Array<{ action: string; metadata: Record<string, unknown> }> = [];

    const worker: DatabaseExplorerWorker = {
      command: async () => {
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
          result: options.workerResult ?? {
            targetId: 'edutrack_production',
            schemaChecksum: 'checksum_1',
            policyVersion: '2026-09-25',
            schema: 'public',
            relation: 'students',
            columns: [],
            rows: [],
            nextCursor: null,
            truncated: false,
            encodedBytes: 100,
            consistency: 'stable',
            piiMode: 'masked'
          }
        };
      }
    };

    const audit: DatabaseExplorerAudit = {
      append: async (input) => {
        if (options.auditFail) {
          throw new Error('Audit ledger unreachable');
        }
        auditEntries.push({ action: input.action, metadata: input.metadata });
        return { id: 'audit_id', entryHash: 'hash' };
      }
    };

    const stepUp = {
      authorize: async () => {
        if (options.stepUpAuthorizeOk === false) {
          throw new Error('STEP_UP_INVALID');
        }
        return { id: 'grant_1' };
      },
      grant: async () => ({
        id: 'grant_1',
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      }),
      revoke: async () => undefined
    } as unknown as StepUpService;

    const service = new DatabaseExplorerService({
      worker,
      audit,
      stepUp,
      findUserTotpFactorId: async () => 'factor_totp_1',
      getTargetSummaries: () => [
        {
          id: 'edutrack_production',
          label: 'EduTrack Production',
          status: 'available',
          readOnly: true
        }
      ]
    });

    return { service, auditEntries };
  }

  it('rejects viewer row queries with 403 DATABASE_DATA_PERMISSION_DENIED without calling worker', async () => {
    let workerCalled = false;
    const { service } = createService();
    (service as any).input.worker.command = async () => {
      workerCalled = true;
      return { ok: true, result: {} };
    };

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
    const { service, auditEntries } = createService();

    // Missing grantId
    await expect(
      service.queryRows({
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

    // Valid grantId
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
      grantId: 'grant_1',
      ...mockContext
    });

    expect(response).toBeDefined();
    expect(auditEntries).toContainEqual(
      expect.objectContaining({ action: 'database.rows_viewed' })
    );
    expect(auditEntries).toContainEqual(
      expect.objectContaining({ action: 'database.pii_rows_viewed' })
    );
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

    expect(revealResult.grantId).toBe('grant_1');
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
});
