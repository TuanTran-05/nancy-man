type ParameterizedDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type SqlExecutionRow = {
  id: string;
  executionKey: string;
  actorUserId: string;
  actorDisplayName: string;
  executionKind: 'read' | 'dml' | 'ddl' | 'special' | 'recovery';
  status:
    | 'previewed'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'drifted'
    | 'rolled_back';
  reason: string;
  fingerprint: string;
  requestedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  affectedRows: string | number | null;
  resultTruncated: boolean;
  issueId: string | null;
  incidentId: string | null;
  errorCode: string | null;
};

export type SqlExecutionSummary = Omit<SqlExecutionRow, 'affectedRows'> & {
  affectedRows: number | null;
};

export class PostgresSqlExecutionStore {
  constructor(private readonly database: ParameterizedDatabase) {}

  async startReadPreview(input: {
    id: string;
    executionKey: string;
    actorUserId: string;
    sessionId: string;
    reason: string;
    encryptedSql: string;
    redactedSql: string;
    fingerprint: string;
    issueId?: string;
    incidentId?: string;
    metadata: Record<string, unknown>;
  }): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `INSERT INTO sql_executions (
         id, execution_key, actor_user_id, session_id, execution_kind, status,
         reason, original_sql_ciphertext, redacted_sql, normalized_fingerprint,
         issue_id, incident_id, metadata
       ) VALUES (
         $1, $2, $3, $4, 'read', 'running',
         $5, convert_to($6, 'utf8'), $7, $8,
         $9, $10, $11::jsonb
       )
       ON CONFLICT (execution_key) DO NOTHING
       RETURNING id`,
      [
        input.id,
        input.executionKey,
        input.actorUserId,
        input.sessionId,
        input.reason,
        input.encryptedSql,
        input.redactedSql,
        input.fingerprint,
        input.issueId ?? null,
        input.incidentId ?? null,
        JSON.stringify(input.metadata)
      ]
    );
    return rows.length === 1;
  }

  async finishReadPreview(input: {
    executionId: string;
    status: 'previewed' | 'failed' | 'cancelled';
    durationMs: number;
    rowCount: number;
    truncated: boolean;
    metadata: Record<string, unknown>;
  }): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `UPDATE sql_executions
       SET status = $2, completed_at = now(), duration_ms = $3,
           affected_rows = $4, result_truncated = $5,
           metadata = metadata || $6::jsonb
       WHERE id = $1 AND status = 'running'
       RETURNING id`,
      [
        input.executionId,
        input.status,
        input.durationMs,
        input.rowCount,
        input.truncated,
        JSON.stringify(input.metadata)
      ]
    );
    return rows.length === 1;
  }

  async list(input: { limit: number }): Promise<SqlExecutionSummary[]> {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const { rows } = await this.database.query<SqlExecutionRow>(
      `SELECT execution.id, execution.execution_key AS "executionKey",
        execution.actor_user_id AS "actorUserId", actor.display_name AS "actorDisplayName",
        execution.execution_kind AS "executionKind", execution.status, execution.reason,
        execution.normalized_fingerprint AS fingerprint, execution.requested_at AS "requestedAt",
        execution.completed_at AS "completedAt", execution.duration_ms AS "durationMs",
        execution.affected_rows AS "affectedRows", execution.result_truncated AS "resultTruncated",
        execution.issue_id AS "issueId", execution.incident_id AS "incidentId",
        execution.metadata ->> 'errorCode' AS "errorCode"
       FROM sql_executions AS execution
       LEFT JOIN ops_users AS actor ON actor.id = execution.actor_user_id
       ORDER BY execution.requested_at DESC, execution.id DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map((row) => ({
      ...row,
      affectedRows: row.affectedRows === null ? null : Number(row.affectedRows)
    }));
  }
}
