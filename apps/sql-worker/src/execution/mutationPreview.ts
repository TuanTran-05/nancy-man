import { createHash } from 'node:crypto';

import { classifyMutationSql } from './mutationClassification.js';

type Database = {
  query: <T>(
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type JournalRow = {
  journalId: string | number;
  schemaName: string;
  tableName: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  primaryKey: unknown;
  beforeRow: unknown;
  afterRow: unknown;
  walLsn: string;
  changedAt: string;
};

export type MutationPreview = {
  affectedRows: number;
  changes: JournalRow[];
  truncated: boolean;
};

function statement(sql: string): string {
  return sql.replace(/;\s*$/, '').trim();
}

function fingerprint(sql: string): string {
  return createHash('sha256').update(sql.replace(/\s+/g, ' '), 'utf8').digest('hex');
}

export async function previewMutation(input: {
  database: Database;
  executionId: string;
  executionKey: string;
  actorUserId: string;
  actorSessionId: string;
  reason: string;
  sql: string;
  maxChanges?: number;
}): Promise<MutationPreview> {
  const classification = classifyMutationSql(input.sql);
  if (!classification.allowed) throw new Error(classification.code);
  const maxChanges = Math.min(Math.max(input.maxChanges ?? 100, 1), 500);
  const sql = statement(input.sql);
  let transactionOpen = false;

  try {
    await input.database.query('BEGIN');
    transactionOpen = true;
    await input.database.query("SET LOCAL statement_timeout = '30s'");
    await input.database.query("SET LOCAL lock_timeout = '3s'");
    await input.database.query("SELECT set_config('ops.execution_id', $1, true)", [
      input.executionId
    ]);
    await input.database.query(
      "SELECT set_config('ops.actor_user_id', $1, true)",
      [input.actorUserId]
    );
    await input.database.query(
      "SELECT set_config('ops.actor_session_id', $1, true)",
      [input.actorSessionId]
    );
    await input.database.query("SELECT set_config('ops.statement_index', '0', true)");
    await input.database.query(
      'SELECT _ops.begin_dml_execution($1::uuid, $2, $3, $4)',
      [
        input.executionId,
        input.executionKey,
        input.reason,
        fingerprint(sql)
      ]
    );
    const mutation = await input.database.query(sql);
    const { rows } = await input.database.query<JournalRow>(
      `SELECT journal_id AS "journalId", schema_name AS "schemaName", table_name AS "tableName",
         operation, primary_key AS "primaryKey", before_row AS "beforeRow", after_row AS "afterRow",
         wal_lsn::text AS "walLsn", changed_at AS "changedAt"
       FROM _ops.row_change_journal
       WHERE execution_id = $1
       ORDER BY journal_id ASC
       LIMIT $2`,
      [input.executionId, maxChanges + 1]
    );
    await input.database.query('ROLLBACK');
    transactionOpen = false;
    const changes = rows.slice(0, maxChanges);
    const affectedRows = mutation.rowCount ?? changes.length;
    if (affectedRows > 0 && changes.length === 0) throw new Error('ROW_JOURNAL_MISSING');
    return { affectedRows, changes, truncated: rows.length > maxChanges };
  } catch {
    if (transactionOpen) await input.database.query('ROLLBACK').catch(() => undefined);
    throw new Error('SQL_MUTATION_PREVIEW_FAILED');
  }
}
