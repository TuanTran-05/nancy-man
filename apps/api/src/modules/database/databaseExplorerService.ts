import { createHash } from 'node:crypto';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRowsResponse,
  DatabaseTargetId,
  DatabaseTargetSummary
} from '../../../../../packages/contracts/src/databaseExplorer.js';
import type { SqlWorkerActor } from '../../../../../packages/contracts/src/workerProtocol.js';
import type { StepUpGrant, StepUpService } from '../auth/stepUpService.js';
import {
  DatabaseRowsResponseSchema,
  type DatabasePiiRevealBodySchema,
  type DatabaseRelatedRowsQueryBodySchema,
  type DatabaseRowsQueryBodySchema
} from './databaseSchemas.js';
import { z } from 'zod';

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
    kind: 'database.schema' | 'database.rows' | 'database.relatedRows';
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
  getTargetSummaries: () => DatabaseTargetSummary[];
  now?: () => Date;
};

export class DatabaseExplorerService {
  private readonly now: () => Date;

  constructor(private readonly input: DatabaseExplorerServiceInput) {
    this.now = input.now ?? (() => new Date());
  }

  async getTargets(): Promise<{ targets: DatabaseTargetSummary[] }> {
    return { targets: this.input.getTargetSummaries() };
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

    const snapshot = workerResult.result as DatabaseExplorerSchemaSnapshot;

    try {
      await this.input.audit.append({
        actorUserId: input.actor.userId,
        action: 'database.schema_viewed',
        subjectType: 'database',
        subjectId: input.targetId,
        requestId: input.requestId,
        ipHash: input.ipHash,
        metadata: {
          targetId: input.targetId,
          checksum: snapshot.checksum
        }
      });
    } catch {
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    return snapshot;
  }

  async queryRows(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    query: DatabaseRowsQueryBody;
    grantId?: string;
    requestId?: string;
    ipHash: string;
    userAgentHash: string;
  }): Promise<DatabaseRowsResponse> {
    if (input.actor.role === 'ops_viewer') {
      throw makeExplorerServiceError('DATABASE_DATA_PERMISSION_DENIED', 403);
    }

    if (input.query.piiMode === 'revealed') {
      if (!input.grantId) {
        throw makeExplorerServiceError('DATABASE_PII_REVEAL_REQUIRED', 403);
      }
      const subjectDigest = createHash('sha256').update(input.targetId).digest('hex');
      try {
        await this.input.stepUp.authorize({
          grantId: input.grantId,
          capability: 'database_pii',
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          subjectDigest
        });
      } catch {
        throw makeExplorerServiceError('DATABASE_PII_REVEAL_REQUIRED', 403);
      }
    }

    const workerResult = await this.input.worker.command({
      actor: input.actor,
      kind: 'database.rows',
      payload: {
        ...input.query,
        targetId: input.targetId
      }
    });

    if (!workerResult.ok) {
      throw makeExplorerServiceError(
        workerResult.error.code,
        mapWorkerErrorToStatus(workerResult.error.code)
      );
    }

    const parsed = DatabaseRowsResponseSchema.safeParse(workerResult.result);
    if (!parsed.success) {
      throw makeExplorerServiceError('WORKER_DATABASE_RESPONSE_INVALID', 503);
    }

    const responseData = parsed.data;

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
        requestId: input.requestId,
        ipHash: input.ipHash,
        metadata: {
          targetId: input.targetId,
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

      if (input.query.piiMode === 'revealed') {
        await this.input.audit.append({
          actorUserId: input.actor.userId,
          action: 'database.pii_rows_viewed',
          subjectType: 'database',
          subjectId: input.targetId,
          requestId: input.requestId,
          ipHash: input.ipHash,
          metadata: {
            targetId: input.targetId,
            schema: input.query.schema,
            relation: input.query.relation,
            grantId: input.grantId
          }
        });
      }
    } catch {
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    return responseData as DatabaseRowsResponse;
  }

  async queryRelatedRows(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    query: DatabaseRelatedRowsQueryBody;
    grantId?: string;
    requestId?: string;
    ipHash: string;
    userAgentHash: string;
  }): Promise<DatabaseRowsResponse> {
    if (input.actor.role === 'ops_viewer') {
      throw makeExplorerServiceError('DATABASE_DATA_PERMISSION_DENIED', 403);
    }

    if (input.query.piiMode === 'revealed') {
      if (!input.grantId) {
        throw makeExplorerServiceError('DATABASE_PII_REVEAL_REQUIRED', 403);
      }
      const subjectDigest = createHash('sha256').update(input.targetId).digest('hex');
      try {
        await this.input.stepUp.authorize({
          grantId: input.grantId,
          capability: 'database_pii',
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          subjectDigest
        });
      } catch {
        throw makeExplorerServiceError('DATABASE_PII_REVEAL_REQUIRED', 403);
      }
    }

    const workerResult = await this.input.worker.command({
      actor: input.actor,
      kind: 'database.relatedRows',
      payload: {
        ...input.query,
        targetId: input.targetId
      }
    });

    if (!workerResult.ok) {
      throw makeExplorerServiceError(
        workerResult.error.code,
        mapWorkerErrorToStatus(workerResult.error.code)
      );
    }

    const parsed = DatabaseRowsResponseSchema.safeParse(workerResult.result);
    if (!parsed.success) {
      throw makeExplorerServiceError('WORKER_DATABASE_RESPONSE_INVALID', 503);
    }

    const responseData = parsed.data;

    try {
      await this.input.audit.append({
        actorUserId: input.actor.userId,
        action: 'database.rows_viewed',
        subjectType: 'database',
        subjectId: input.targetId,
        requestId: input.requestId,
        ipHash: input.ipHash,
        metadata: {
          targetId: input.targetId,
          schema: input.query.schema,
          relation: input.query.relation,
          pageSize: input.query.pageSize,
          returnedCount: responseData.rows.length,
          policyVersion: responseData.policyVersion,
          piiMode: input.query.piiMode,
          relatedConstraint: input.query.constraint
        }
      });

      if (input.query.piiMode === 'revealed') {
        await this.input.audit.append({
          actorUserId: input.actor.userId,
          action: 'database.pii_rows_viewed',
          subjectType: 'database',
          subjectId: input.targetId,
          requestId: input.requestId,
          ipHash: input.ipHash,
          metadata: {
            targetId: input.targetId,
            schema: input.query.schema,
            relation: input.query.relation,
            grantId: input.grantId
          }
        });
      }
    } catch {
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    return responseData as DatabaseRowsResponse;
  }

  async revealPii(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    body: DatabasePiiRevealBody;
    requestId?: string;
    ipHash: string;
    userAgentHash: string;
  }): Promise<{ grantId: string; targetId: string; expiresAt: string }> {
    if (input.actor.role === 'ops_viewer') {
      throw makeExplorerServiceError('PERMISSION_DENIED', 403);
    }

    const factorId = await this.input.findUserTotpFactorId(input.actor.userId);
    if (!factorId) {
      throw makeExplorerServiceError('MFA_FACTOR_UNAVAILABLE', 400);
    }

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
    } catch {
      throw makeExplorerServiceError('AUTH_DENIED', 401);
    }

    try {
      await this.input.audit.append({
        actorUserId: input.actor.userId,
        action: 'database.pii_reveal_granted',
        subjectType: 'database',
        subjectId: input.targetId,
        requestId: input.requestId,
        ipHash: input.ipHash,
        metadata: {
          targetId: input.targetId,
          grantId: grant.id,
          reason: input.body.reason,
          expiresAt: grant.expiresAt
        }
      });
    } catch {
      // Revoke grant if audit append fails
      try {
        await this.input.stepUp.revoke({
          grantId: grant.id,
          capability: 'database_pii',
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash
        });
      } catch {
        // ignore
      }
      throw makeExplorerServiceError('DATABASE_AUDIT_UNAVAILABLE', 503);
    }

    return {
      grantId: grant.id,
      targetId: input.targetId,
      expiresAt: grant.expiresAt
    };
  }

  async revokePiiReveal(input: {
    actor: SqlWorkerActor;
    targetId: DatabaseTargetId;
    grantId?: string;
    requestId?: string;
    ipHash: string;
    userAgentHash: string;
  }): Promise<{ ok: true }> {
    if (input.grantId) {
      try {
        await this.input.stepUp.revoke({
          grantId: input.grantId,
          capability: 'database_pii',
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash
        });
      } catch {
        // ignore
      }

      try {
        await this.input.audit.append({
          actorUserId: input.actor.userId,
          action: 'database.pii_reveal_revoked',
          subjectType: 'database',
          subjectId: input.targetId,
          requestId: input.requestId,
          ipHash: input.ipHash,
          metadata: {
            targetId: input.targetId,
            grantId: input.grantId
          }
        });
      } catch {
        // ignore
      }
    }

    return { ok: true };
  }
}
