type ParameterizedDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
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
}
