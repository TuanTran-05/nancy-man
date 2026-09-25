import { createHash } from 'node:crypto';
import { z } from 'zod';

import { captureOpsException } from '../../telemetry/runtimeTelemetry.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRowsResponse,
  DatabaseTargetId,
  DatabaseTargetSummary
} from '../../../../../packages/contracts/src/databaseExplorer.js';
import { databaseExplorerCommandSchemas } from '../../../../../packages/contracts/src/databaseExplorerSchemas.js';
import type { SqlWorkerActor } from '../../../../../packages/contracts/src/workerProtocol.js';
import type { StepUpGrant, StepUpService } from '../auth/stepUpService.js';
import {
  DatabasePiiRevealBodySchema,
  DatabaseRelatedRowsQueryBodySchema,
  DatabaseRowsQueryBodySchema
} from './databaseSchemas.js';
import { SchemaViewAuditLimiter } from './schemaViewAuditLimiter.js';

export type DatabaseRowsQueryBody = z.infer<typeof DatabaseRowsQueryBodySchema>;
export type DatabaseRelatedRowsQueryBody = z.infer<typeof DatabaseRelatedRowsQueryBodySchema>;
export type DatabasePiiRevealBody = z.infer<typeof DatabasePiiRevealBodySchema>;

export class DatabaseExplorerServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string
  ) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'DatabaseExplorerServiceError';
  }
}

export function makeExplorerServiceError(
  code: string,
  status: number,
  message?: string
): DatabaseExplorerServiceError {
  return new DatabaseExplorerServiceError(code, status, message);
}

export function mapWorkerErrorToStatus(code: string): number {
  switch (code) {
    case 'DATABASE_TARGET_INVALID':
    case 'DATABASE_RELATION_INVALID':
    case 'DATABASE_COLUMN_INVALID':
    case 'DATABASE_FILTER_INVALID':
    case 'DATABASE_CURSOR_INVALID':
    case 'DATABASE_PAGE_TOO_LARGE':
      return 400;
    case 'DATABASE_DATA_PERMISSION_DENIED':
    case 'PERMISSION_DENIED':
      return 403;
    case 'DATABASE_TARGET_UNAVAILABLE':
    case 'DATABASE_SCHEMA_STALE':
    case 'DATABASE_QUERY_TIMEOUT':
    case 'DATABASE_RESULT_TOO_LARGE':
    case 'DATABASE_EXPLORER_DISABLED':
      return 503;
    default:
      return 500;
  }
}

export type DatabaseExplorerWorker = {
  command: (input: {
    actor: SqlWorkerActor;
    kind: 'database.targets' | 'database.schema' | 'database.rows' | 'database.relatedRows';
    payload: unknown;
  }) => Promise<
    | { protocolVersion: 1; commandId: string; ok: true; result: unknown }
    | {
        protocolVersion: 1;
        commandId: string;
        ok: false;
        error: { code: string; safeMessage?: string };
      }
  >;
};

export type DatabaseExplorerAudit = {
  append: (input: {
    actorUserId: string | null;
    action: string;
    subjectType: string;
    subjectId?: string;
    requestId?: string;
    ipHash?: string;
    metadata: Record<string, unknown>;
  }) => Promise<{ id: string; entryHash: string }>;
};

export type DatabaseExplorerServiceInput = {
  worker: DatabaseExplorerWorker;
  audit: DatabaseExplorerAudit;
  stepUp: StepUpService;
  findUserTotpFactorId: (userId: string) => Promise<string | null>;
  schemaViewAuditLimiter?: SchemaViewAuditLimiter;
  now?: () => Date;
};

export class DatabaseExplorerService {
  private readonly schemaViewAuditLimiter: SchemaViewAuditLimiter;

  constructor(private readonly input: DatabaseExplorerServiceInput) {
    this.schemaViewAuditLimiter =
      input.schemaViewAuditLimiter ??
      new SchemaViewAuditLimiter(input.now ? { now: input.now } : {});
  }

  async getTargets(actor: SqlWorkerActor): Promise<{ targets: DatabaseTargetSummary[] }> {
    const workerResult = await this.input.worker.command({
      actor,
      kind: 'database.targets',
      payload: {}
    });
    if (!workerResult.ok) {
      throw makeExplorerServiceError(
        workerResult.error.code,
        mapWorkerErrorToStatus(workerResult.error.code)
      );
    }
    const parsed = databaseExplorerCommandSchemas['database.targets'].result.safeParse(
      workerResult.result
    );
    if (!parsed.success) throw makeExplorerServiceError('WORKER_DATABASE_RESPONSE_INVALID', 503);
    return {
      targets: parsed.data.map((target) => ({
        id: target.id,
        label: target.label,
        status: target.status,
        readOnly: target.readOnly,
        ...(target.description !== undefined ? { description: target.description } : {}),
        ...(target.unavailableReason !== undefined
          ? { unavailableReason: target.unavailableReason }
          : {})
      }))
    };
  }

  async getSchema(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    requestId?: string;
    ipHash?: string;
  }): Promise<DatabaseExplorerSchemaSnapshot> {
    const workerResult = await this.input.worker.command({
      actor: input.actor,
      kind: 'database.schema',
      payload: { targetId: input.targetId }
    });
    if (!workerResult.ok) {
      throw makeExplorerServiceError(
        workerResult.error.code,
        mapWorkerErrorToStatus(workerResult.error.code)
      );
    }

    const parsed = databaseExplorerCommandSchemas['database.schema'].result.safeParse(
      workerResult.result
    );
    if (!parsed.success || parsed.data.targetId !== input.targetId) {
      throw makeExplorerServiceError('WORKER_DATABASE_RESPONSE_INVALID', 503);
    }
    const snapshot = parsed.data as DatabaseExplorerSchemaSnapshot;

    try {
      await this.schemaViewAuditLimiter.run(
        {
          actorUserId: input.actor.userId,
          targetId: input.targetId,
          schemaChecksum: snapshot.checksum
        },
        () =>
          this.input.audit.append({
            actorUserId: input.actor.userId,
            action: 'database.schema_viewed',
            subjectType: 'database',
            subjectId: input.targetId,
            ...(input.requestId ? { requestId: input.requestId } : {}),
            ...(input.ipHash ? { ipHash: input.ipHash } : {}),
            metadata: {
              targetId: input.targetId,
              schemaChecksum: snapshot.checksum
            }
          })
      );
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500
      });
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    return snapshot;
  }

  private async authorizePii(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    ipHash: string;
    userAgentHash: string;
  }): Promise<StepUpGrant> {
    try {
      return await this.input.stepUp.authorizeDatabasePii({
        capability: 'database_pii',
        userId: input.actor.userId,
        sessionId: input.actor.sessionId,
        ipHash: input.ipHash,
        userAgentHash: input.userAgentHash,
        subjectDigest: createHash('sha256').update(input.targetId).digest('hex')
      });
    } catch (error) {
      captureOpsException(error, { code: 'UNHANDLED_OPS_EXCEPTION', source: 'api', status: 500 });
      throw makeExplorerServiceError('DATABASE_PII_REVEAL_REQUIRED', 403);
    }
  }

  async queryRows(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    query: DatabaseRowsQueryBody;
    requestId?: string;
    ipHash: string;
    userAgentHash: string;
  }): Promise<DatabaseRowsResponse> {
    if (input.actor.role === 'ops_viewer') {
      throw makeExplorerServiceError('DATABASE_DATA_PERMISSION_DENIED', 403);
    }

    const grant =
      input.query.piiMode === 'revealed'
        ? await this.authorizePii({
            actor: input.actor,
            targetId: input.targetId,
            ipHash: input.ipHash,
            userAgentHash: input.userAgentHash
          })
        : undefined;

    const workerResult = await this.input.worker.command({
      actor: input.actor,
      kind: 'database.rows',
      payload: { ...input.query, targetId: input.targetId }
    });
    if (!workerResult.ok) {
      throw makeExplorerServiceError(
        workerResult.error.code,
        mapWorkerErrorToStatus(workerResult.error.code)
      );
    }

    const parsed = databaseExplorerCommandSchemas['database.rows'].result.safeParse(
      workerResult.result
    );
    if (
      !parsed.success ||
      parsed.data.targetId !== input.targetId ||
      parsed.data.schema !== input.query.schema ||
      parsed.data.relation !== input.query.relation ||
      parsed.data.piiMode !== input.query.piiMode
    ) {
      throw makeExplorerServiceError('WORKER_DATABASE_RESPONSE_INVALID', 503);
    }
    const responseData = parsed.data as DatabaseRowsResponse;
    const filtersFingerprint = createHash('sha256')
      .update(JSON.stringify(input.query.filters))
      .digest('hex');
    const sortFingerprint = createHash('sha256')
      .update(JSON.stringify(input.query.sort ?? null))
      .digest('hex');

    try {
      await this.input.audit.append({
        actorUserId: input.actor.userId,
        action: 'database.rows_viewed',
        subjectType: 'database',
        subjectId: input.targetId,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ipHash: input.ipHash,
        metadata: {
          targetId: input.targetId,
          schemaChecksum: responseData.schemaChecksum,
          schema: input.query.schema,
          relation: input.query.relation,
          pageSize: input.query.pageSize,
          returnedCount: responseData.rows.length,
          filtersFingerprint,
          sortFingerprint,
          policyVersion: responseData.policyVersion,
          piiMode: input.query.piiMode
        }
      });
      if (grant) {
        await this.input.audit.append({
          actorUserId: input.actor.userId,
          action: 'database.pii_rows_viewed',
          subjectType: 'database',
          subjectId: input.targetId,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ipHash: input.ipHash,
          metadata: {
            targetId: input.targetId,
            schemaChecksum: responseData.schemaChecksum,
            schema: input.query.schema,
            relation: input.query.relation
          }
        });
      }
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500
      });
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    return responseData;
  }

  async queryRelatedRows(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    query: DatabaseRelatedRowsQueryBody;
    requestId?: string;
    ipHash: string;
    userAgentHash: string;
  }): Promise<DatabaseRowsResponse> {
    if (input.actor.role === 'ops_viewer') {
      throw makeExplorerServiceError('DATABASE_DATA_PERMISSION_DENIED', 403);
    }

    const grant =
      input.query.piiMode === 'revealed'
        ? await this.authorizePii({
            actor: input.actor,
            targetId: input.targetId,
            ipHash: input.ipHash,
            userAgentHash: input.userAgentHash
          })
        : undefined;

    const workerResult = await this.input.worker.command({
      actor: input.actor,
      kind: 'database.relatedRows',
      payload: { ...input.query, targetId: input.targetId }
    });
    if (!workerResult.ok) {
      throw makeExplorerServiceError(
        workerResult.error.code,
        mapWorkerErrorToStatus(workerResult.error.code)
      );
    }

    const parsed = databaseExplorerCommandSchemas['database.relatedRows'].result.safeParse(
      workerResult.result
    );
    if (
      !parsed.success ||
      parsed.data.targetId !== input.targetId ||
      parsed.data.schema !== input.query.schema ||
      parsed.data.relation !== input.query.relation ||
      parsed.data.piiMode !== input.query.piiMode
    ) {
      throw makeExplorerServiceError('WORKER_DATABASE_RESPONSE_INVALID', 503);
    }
    const responseData = parsed.data as DatabaseRowsResponse;

    try {
      await this.input.audit.append({
        actorUserId: input.actor.userId,
        action: 'database.rows_viewed',
        subjectType: 'database',
        subjectId: input.targetId,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ipHash: input.ipHash,
        metadata: {
          targetId: input.targetId,
          schemaChecksum: responseData.schemaChecksum,
          schema: input.query.schema,
          relation: input.query.relation,
          pageSize: input.query.pageSize,
          returnedCount: responseData.rows.length,
          policyVersion: responseData.policyVersion,
          piiMode: input.query.piiMode,
          relatedConstraint: input.query.constraint
        }
      });
      if (grant) {
        await this.input.audit.append({
          actorUserId: input.actor.userId,
          action: 'database.pii_rows_viewed',
          subjectType: 'database',
          subjectId: input.targetId,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ipHash: input.ipHash,
          metadata: {
            targetId: input.targetId,
            schemaChecksum: responseData.schemaChecksum,
            schema: input.query.schema,
            relation: input.query.relation
          }
        });
      }
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500
      });
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    return responseData;
  }

  async revealPii(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    body: DatabasePiiRevealBody;
    requestId?: string;
    ipHash: string;
    userAgentHash: string;
  }): Promise<{ expiresAt: string }> {
    if (input.actor.role === 'ops_viewer') {
      throw makeExplorerServiceError('PERMISSION_DENIED', 403);
    }
    const factorId = await this.input.findUserTotpFactorId(input.actor.userId);
    if (!factorId) throw makeExplorerServiceError('MFA_FACTOR_UNAVAILABLE', 400);
    const subjectDigest = createHash('sha256').update(input.targetId).digest('hex');

    let grant: StepUpGrant;
    try {
      grant = await this.input.stepUp.grant({
        capability: 'database_pii',
        userId: input.actor.userId,
        sessionId: input.actor.sessionId,
        password: input.body.password,
        factorId,
        token: input.body.token,
        ipHash: input.ipHash,
        userAgentHash: input.userAgentHash,
        subjectDigest
      });
    } catch (error) {
      captureOpsException(error, { code: 'UNHANDLED_OPS_EXCEPTION', source: 'api', status: 500 });
      throw makeExplorerServiceError('AUTH_DENIED', 401);
    }

    try {
      await this.input.audit.append({
        actorUserId: input.actor.userId,
        action: 'database.pii_reveal_granted',
        subjectType: 'database',
        subjectId: input.targetId,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ipHash: input.ipHash,
        metadata: {
          targetId: input.targetId,
          reason: input.body.reason,
          expiresAt: grant.expiresAt
        }
      });
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500
      });
      try {
        await this.input.stepUp.revokeDatabasePii({
          capability: 'database_pii',
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          subjectDigest
        });
      } catch (revokeError) {
        captureOpsException(revokeError, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'api',
          status: 500
        });
      }
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    try {
      const activated = await this.input.stepUp.activateDatabasePiiGrant({
        grantId: grant.id,
        capability: 'database_pii',
        userId: input.actor.userId,
        sessionId: input.actor.sessionId,
        ipHash: input.ipHash,
        userAgentHash: input.userAgentHash,
        subjectDigest
      });
      if (!activated) throw new Error('DATABASE_PII_GRANT_ACTIVATION_FAILED');
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500
      });
      try {
        await this.input.stepUp.revokeDatabasePii({
          capability: 'database_pii',
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          subjectDigest
        });
      } catch (revokeError) {
        captureOpsException(revokeError, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'api',
          status: 500
        });
      }
      throw makeExplorerServiceError('DATABASE_PII_GRANT_ACTIVATION_FAILED', 503);
    }

    return { expiresAt: grant.expiresAt };
  }

  async revokePiiReveal(input: {
    actor: SqlWorkerActor;
    requestId?: string;
    ipHash: string;
    userAgentHash: string;
  }): Promise<{ ok: true }> {
    let revokedCount: number;
    try {
      revokedCount = await this.input.stepUp.revokeDatabasePii({
        capability: 'database_pii',
        userId: input.actor.userId,
        sessionId: input.actor.sessionId,
        ipHash: input.ipHash,
        userAgentHash: input.userAgentHash
      });
    } catch (error) {
      captureOpsException(error, { code: 'UNHANDLED_OPS_EXCEPTION', source: 'api', status: 500 });
      throw makeExplorerServiceError('DATABASE_REVOKE_UNAVAILABLE', 503);
    }

    try {
      await this.input.audit.append({
        actorUserId: input.actor.userId,
        action: 'database.pii_reveal_revoked',
        subjectType: 'database',
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ipHash: input.ipHash,
        metadata: { capability: 'database_pii', revokedCount }
      });
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'database',
        status: 500
      });
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    return { ok: true };
  }
}
