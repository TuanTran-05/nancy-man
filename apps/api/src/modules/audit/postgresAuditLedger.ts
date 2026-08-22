import { randomUUID } from 'node:crypto';

import { createAuditEntryHash } from '../../../../../packages/security/src/audit/hashChain.js';

type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type TransactionalDatabase = {
  transaction: <T>(operation: (database: QueryDatabase) => Promise<T>) => Promise<T>;
};

export class PostgresOpsAuditLedger {
  private readonly now: () => Date;
  private readonly issueId: () => string;

  constructor(
    private readonly input: {
      database: TransactionalDatabase;
      now?: () => Date;
      issueId?: () => string;
    }
  ) {
    this.now = input.now ?? (() => new Date());
    this.issueId = input.issueId ?? randomUUID;
  }

  async append(input: {
    actorUserId: string | null;
    action: string;
    subjectType: string;
    subjectId?: string;
    requestId?: string;
    ipHash?: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string; entryHash: string }> {
    if (!/^[a-z][a-z0-9._-]{2,99}$/.test(input.action)) {
      throw new Error('Audit action is invalid');
    }
    if (!/^[a-z][a-z0-9._-]{2,99}$/.test(input.subjectType)) {
      throw new Error('Audit subject type is invalid');
    }
    if (input.ipHash !== undefined && !/^[a-f0-9]{64}$/.test(input.ipHash)) {
      throw new Error('Audit IP hash is invalid');
    }
    const id = this.issueId();
    const occurredAt = this.now().toISOString();
    return this.input.database.transaction(async (database) => {
      await database.query('SELECT pg_advisory_xact_lock($1)', [2_071_589_137]);
      const { rows } = await database.query<{ entryHash: string }>(
        `SELECT entry_hash AS "entryHash"
         FROM ops_audit_entries
         ORDER BY audit_sequence DESC
         LIMIT 1
         FOR UPDATE`
      );
      const previousHash = rows[0]?.entryHash ?? null;
      const payload = {
        id,
        occurredAt,
        actorUserId: input.actorUserId,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        requestId: input.requestId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata
      };
      const entryHash = createAuditEntryHash({ previousHash, payload });
      await database.query(
        `INSERT INTO ops_audit_entries (
           id, occurred_at, actor_user_id, action, subject_type, subject_id,
           request_id, ip_hash, metadata, previous_hash, entry_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [
          id,
          occurredAt,
          input.actorUserId,
          input.action,
          input.subjectType,
          input.subjectId ?? null,
          input.requestId ?? null,
          input.ipHash ?? null,
          JSON.stringify(input.metadata),
          previousHash,
          entryHash
        ]
      );
      return { id, entryHash };
    });
  }
}
