import { previewMutation, type MutationPreview } from '../execution/mutationPreview.js';

export type MutationQueryDatabase = {
  query: <T>(
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

export type MutationConnection = MutationQueryDatabase & { release: () => void };

export type MutationPool = {
  connect: () => Promise<MutationConnection>;
};

type MutationIdentity = {
  role: string;
  database: string;
  defaultTransactionReadOnly: string | null;
};

export async function assertProductionMutationIdentity(input: {
  database: MutationQueryDatabase;
  expectedRole: string;
  expectedDatabase: string;
}): Promise<{ role: string; database: string }> {
  const { rows } = await input.database.query<MutationIdentity>(
    'SELECT current_user::text AS "role", current_database()::text AS "database", current_setting(\'default_transaction_read_only\', true) AS "defaultTransactionReadOnly"'
  );
  const identity = rows[0];
  if (
    !identity ||
    identity.role !== input.expectedRole ||
    identity.database !== input.expectedDatabase ||
    identity.defaultTransactionReadOnly !== 'off'
  ) {
    throw new Error('Production mutation connection identity is not writable');
  }
  return { role: identity.role, database: identity.database };
}

export function createMutationPreviewer(input: {
  pool: MutationPool;
}): (input: {
  executionId: string;
  executionKey: string;
  actorUserId: string;
  actorSessionId: string;
  reason: string;
  sql: string;
  maxChanges?: number;
}) => Promise<MutationPreview> {
  return async ({
    executionId,
    executionKey,
    actorUserId,
    actorSessionId,
    reason,
    sql,
    maxChanges
  }) => {
    const connection = await input.pool.connect();
    try {
      return await previewMutation({
        database: connection,
        executionId,
        executionKey,
        actorUserId,
        actorSessionId,
        reason,
        sql,
        ...(maxChanges === undefined ? {} : { maxChanges })
      });
    } finally {
      connection.release();
    }
  };
}
