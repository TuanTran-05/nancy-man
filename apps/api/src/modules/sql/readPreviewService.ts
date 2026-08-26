import { createHash, randomUUID } from 'node:crypto';

import { encryptEnvelope } from '../../../../../packages/security/src/encryption/envelope.js';

type SqlActor = {
  userId: string;
  sessionId: string;
  role: 'ops_maintainer' | 'ops_owner';
};

type PreviewResult = { rows: unknown[]; encodedBytes: number; truncated: boolean };

function isPreviewResult(value: unknown): value is PreviewResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as { rows?: unknown; encodedBytes?: unknown; truncated?: unknown };
  return (
    Array.isArray(result.rows) &&
    typeof result.encodedBytes === 'number' &&
    Number.isSafeInteger(result.encodedBytes) &&
    result.encodedBytes >= 0 &&
    typeof result.truncated === 'boolean'
  );
}

function executionKey(now: Date, id: string): string {
  return `SQL-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${id}`;
}

function fingerprint(sql: string): string {
  return createHash('sha256').update(sql.trim().replace(/\s+/g, ' '), 'utf8').digest('hex');
}

export class SqlReadPreviewService {
  private readonly now: () => Date;
  private readonly createExecutionId: () => string;

  constructor(
    private readonly input: {
      elevation: {
        consumeActive: (input: { userId: string; sessionId: string }) => Promise<unknown>;
      };
      executionStore: {
        startReadPreview: (input: {
          id: string;
          executionKey: string;
          actorUserId: string;
          sessionId: string;
          reason: string;
          encryptedSql: string;
          redactedSql: string;
          fingerprint: string;
          metadata: Record<string, unknown>;
        }) => Promise<boolean>;
        finishReadPreview: (input: {
          executionId: string;
          status: 'previewed' | 'failed' | 'cancelled';
          durationMs: number;
          rowCount: number;
          truncated: boolean;
          metadata: Record<string, unknown>;
        }) => Promise<boolean>;
      };
      audit: {
        append: (input: {
          actorUserId: string | null;
          action: string;
          subjectType: string;
          subjectId?: string;
          metadata: Record<string, unknown>;
        }) => Promise<unknown>;
      };
      worker: {
        command: (input: {
          actor: SqlActor;
          kind: 'sql.previewRead';
          payload: { sql: string; maxRows?: number };
        }) => Promise<
          | { protocolVersion: 1; commandId: string; ok: true; result: unknown }
          | {
              protocolVersion: 1;
              commandId: string;
              ok: false;
              error: { code: string; safeMessage: string };
            }
        >;
      };
      encryptionKey: Buffer;
      now?: () => Date;
      executionId?: () => string;
    }
  ) {
    this.now = input.now ?? (() => new Date());
    this.createExecutionId = input.executionId ?? randomUUID;
  }

  async preview(input: { actor: SqlActor; sql: string; reason: string; maxRows?: number }): Promise<
    | { status: 'elevation_required' }
    | {
        status: 'previewed';
        executionKey: string;
        previewId: string;
        expiresAt: string;
        result: PreviewResult;
      }
    | { status: 'failed'; code: string }
  > {
    const sql = input.sql.trim();
    const reason = input.reason.trim();
    if (!sql || sql.length > 65_536 || reason.length < 3 || reason.length > 2_000) {
      throw new Error('SQL_PREVIEW_REQUEST_INVALID');
    }
    const elevation = await this.input.elevation.consumeActive({
      userId: input.actor.userId,
      sessionId: input.actor.sessionId
    });
    if (!elevation) return { status: 'elevation_required' };
    const startedAt = this.now();
    const executionId = this.createExecutionId();
    const key = executionKey(startedAt, executionId);
    const previewId = `PRV_${executionId}`;
    const expiresAt = new Date(startedAt.getTime() + 5 * 60 * 1_000).toISOString();
    const sqlFingerprint = fingerprint(sql);
    const encryptedSql = encryptEnvelope({
      plaintext: sql,
      key: this.input.encryptionKey,
      associatedData: `ops-sql-execution:${executionId}`
    });
    const metadata = { previewId, expiresAt, fingerprint: sqlFingerprint };
    const created = await this.input.executionStore.startReadPreview({
      id: executionId,
      executionKey: key,
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId,
      reason,
      encryptedSql,
      redactedSql: 'SQL preview (encrypted)',
      fingerprint: sqlFingerprint,
      metadata
    });
    if (!created) throw new Error('SQL_PREVIEW_RECORD_UNAVAILABLE');
    await this.input.audit.append({
      actorUserId: input.actor.userId,
      action: 'sql.preview_started',
      subjectType: 'sql_execution',
      subjectId: key,
      metadata
    });
    const finishFailure = async (code: string) => {
      const elapsedMs = Math.max(0, this.now().getTime() - startedAt.getTime());
      await this.input.executionStore.finishReadPreview({
        executionId,
        status: 'failed',
        durationMs: elapsedMs,
        rowCount: 0,
        truncated: false,
        metadata: { code, previewId }
      });
      await this.input.audit.append({
        actorUserId: input.actor.userId,
        action: 'sql.preview_failed',
        subjectType: 'sql_execution',
        subjectId: key,
        metadata: { code, previewId }
      });
      return { status: 'failed' as const, code };
    };
    let worker;
    try {
      worker = await this.input.worker.command({
        actor: input.actor,
        kind: 'sql.previewRead',
        payload: {
          sql,
          ...(input.maxRows === undefined ? {} : { maxRows: input.maxRows })
        }
      });
    } catch {
      return finishFailure('SQL_WORKER_UNAVAILABLE');
    }
    if (!worker.ok || !isPreviewResult(worker.result)) {
      return finishFailure(worker.ok ? 'WORKER_PREVIEW_INVALID' : worker.error.code);
    }
    const elapsedMs = Math.max(0, this.now().getTime() - startedAt.getTime());
    const finished = await this.input.executionStore.finishReadPreview({
      executionId,
      status: 'previewed',
      durationMs: elapsedMs,
      rowCount: worker.result.rows.length,
      truncated: worker.result.truncated,
      metadata: { encodedBytes: worker.result.encodedBytes, previewId }
    });
    if (!finished) throw new Error('SQL_PREVIEW_RECORD_UNAVAILABLE');
    await this.input.audit.append({
      actorUserId: input.actor.userId,
      action: 'sql.previewed',
      subjectType: 'sql_execution',
      subjectId: key,
      metadata: {
        previewId,
        encodedBytes: worker.result.encodedBytes,
        rowCount: worker.result.rows.length,
        truncated: worker.result.truncated
      }
    });
    return {
      status: 'previewed',
      executionKey: key,
      previewId,
      expiresAt,
      result: worker.result
    };
  }
}
