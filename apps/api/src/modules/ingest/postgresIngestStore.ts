type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type TransactionalDatabase = QueryDatabase & {
  transaction: <T>(operation: (database: QueryDatabase) => Promise<T>) => Promise<T>;
};

type PersistedRawIngestRecord = {
  id: string;
  receivedAt: Date;
  ingestClientId: string;
  idempotencyKey: string;
  eventId: string;
  source: string;
  requestId?: string;
  traceId?: string;
  payload: object;
  payloadHash: string;
  redacted: boolean;
};

type ExistingIdempotency = { eventId: string; payloadHash: string };

export class IngestIdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key was previously used with a different event payload');
  }
}

export class PostgresIngestStore {
  constructor(private readonly database: TransactionalDatabase) {}

  async findBrowserClient(projectKey: string): Promise<{
    id: string;
    clientKind: 'browser';
    status: 'active' | 'disabled' | 'rotated';
    allowedOrigins: string[];
  } | null> {
    const { rows } = await this.database.query<{
      id: string;
      clientKind: 'browser';
      status: 'active' | 'disabled' | 'rotated';
      allowedOrigins: string[];
    }>(
      `
        SELECT
          id,
          client_kind AS "clientKind",
          status,
          allowed_origins AS "allowedOrigins"
        FROM ingest_clients
        WHERE public_key_id = $1 AND client_kind = 'browser'
        LIMIT 1
      `,
      [projectKey]
    );
    return rows[0] ?? null;
  }

  async findServerClient(keyId: string): Promise<{
    id: string;
    clientKind: 'server' | 'worker' | 'synthetic';
    status: 'active' | 'disabled' | 'rotated';
    secretReference: string;
  } | null> {
    const { rows } = await this.database.query<{
      id: string;
      clientKind: 'server' | 'worker' | 'synthetic';
      status: 'active' | 'disabled' | 'rotated';
      secretReference: string | null;
    }>(
      `
        SELECT
          id,
          client_kind AS "clientKind",
          status,
          secret_reference AS "secretReference"
        FROM ingest_clients
        WHERE public_key_id = $1 AND client_kind IN ('server', 'worker', 'synthetic')
        LIMIT 1
      `,
      [keyId]
    );
    const client = rows[0];
    return client?.secretReference ? { ...client, secretReference: client.secretReference } : null;
  }

  async insertRaw(record: PersistedRawIngestRecord): Promise<{ duplicate: boolean }> {
    return this.database.transaction(async (database) => {
      const accepted = await database.query<ExistingIdempotency>(
        `
          INSERT INTO ingest_idempotency (
            ingest_client_id,
            idempotency_key,
            event_id,
            payload_hash
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (ingest_client_id, idempotency_key) DO NOTHING
          RETURNING event_id AS "eventId", payload_hash AS "payloadHash"
        `,
        [record.ingestClientId, record.idempotencyKey, record.eventId, record.payloadHash]
      );

      if (!accepted.rows[0]) {
        const existing = await database.query<ExistingIdempotency>(
          `
            SELECT event_id AS "eventId", payload_hash AS "payloadHash"
            FROM ingest_idempotency
            WHERE ingest_client_id = $1 AND idempotency_key = $2
            FOR KEY SHARE
          `,
          [record.ingestClientId, record.idempotencyKey]
        );
        const previous = existing.rows[0];
        if (
          !previous ||
          previous.eventId !== record.eventId ||
          previous.payloadHash !== record.payloadHash
        ) {
          throw new IngestIdempotencyConflictError();
        }
        return { duplicate: true };
      }

      await database.query(
        `
          INSERT INTO ingest_envelopes (
            id,
            received_at,
            ingest_client_id,
            idempotency_key,
            event_id,
            source,
            request_id,
            trace_id,
            payload,
            payload_hash,
            redacted
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
        `,
        [
          record.id,
          record.receivedAt,
          record.ingestClientId,
          record.idempotencyKey,
          record.eventId,
          record.source,
          record.requestId ?? null,
          record.traceId ?? null,
          JSON.stringify(record.payload),
          record.payloadHash,
          record.redacted
        ]
      );
      await database.query(
        `
          INSERT INTO ingest_processing (
            envelope_id,
            envelope_received_at,
            received_at
          ) VALUES ($1, $2, $3)
        `,
        [record.id, record.receivedAt, record.receivedAt]
      );
      return { duplicate: false };
    });
  }
}
