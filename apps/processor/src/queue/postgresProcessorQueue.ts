import type { TelemetryEnvelopeV1 } from '../../../../packages/contracts/src/telemetry.js';

type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type ClaimedRow = {
  envelopeId: string;
  receivedAt: Date;
  ingestClientId: string;
  payload: unknown;
};

type SignedIdentity = {
  userRef: string;
  role: string;
  displayLabel: string;
  sessionHash: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unpackPayload(
  payload: unknown
): { envelope: TelemetryEnvelopeV1; identity?: SignedIdentity } | null {
  if (!isRecord(payload) || !isRecord(payload.envelope)) return null;
  const envelope = payload.envelope;
  if (
    envelope.schemaVersion !== 1 ||
    typeof envelope.eventId !== 'string' ||
    typeof envelope.idempotencyKey !== 'string' ||
    !isRecord(envelope.error) ||
    !isRecord(envelope.context)
  ) {
    return null;
  }
  const identity = isRecord(payload.identity)
    ? {
        userRef: String(payload.identity.userRef ?? ''),
        role: String(payload.identity.role ?? ''),
        displayLabel: String(payload.identity.displayLabel ?? ''),
        sessionHash: String(payload.identity.sessionHash ?? '')
      }
    : undefined;
  return {
    envelope: envelope as unknown as TelemetryEnvelopeV1,
    ...(identity &&
    identity.userRef &&
    identity.role &&
    identity.displayLabel &&
    identity.sessionHash
      ? { identity }
      : {})
  };
}

export class PostgresProcessorQueue {
  constructor(private readonly database: QueryDatabase) {}

  async claimNext(
    workerId: string,
    now: Date
  ): Promise<{
    envelopeId: string;
    receivedAt: Date;
    ingestClientId: string;
    envelope: TelemetryEnvelopeV1;
    identity?: SignedIdentity;
  } | null> {
    const { rows } = await this.database.query<ClaimedRow>(
      `
        WITH next_envelope AS (
          SELECT
            processing.envelope_id,
            processing.envelope_received_at,
            envelope.received_at,
            envelope.ingest_client_id,
            envelope.payload
          FROM ingest_processing AS processing
          JOIN ingest_envelopes AS envelope
            ON envelope.id = processing.envelope_id
           AND envelope.received_at = processing.envelope_received_at
          WHERE processing.state IN ('pending', 'retrying')
            AND (processing.next_attempt_at IS NULL OR processing.next_attempt_at <= $1)
          ORDER BY processing.received_at ASC
          FOR UPDATE OF processing SKIP LOCKED
          LIMIT 1
        )
        UPDATE ingest_processing AS processing
        SET state = 'claimed',
            claimed_at = $1,
            claimed_by = $2
        FROM next_envelope
        WHERE processing.envelope_id = next_envelope.envelope_id
          AND processing.envelope_received_at = next_envelope.envelope_received_at
        RETURNING
          next_envelope.envelope_id AS "envelopeId",
          next_envelope.received_at AS "receivedAt",
          next_envelope.ingest_client_id AS "ingestClientId",
          next_envelope.payload
      `,
      [now, workerId]
    );
    const row = rows[0];
    if (!row) return null;
    const unpacked = unpackPayload(row.payload);
    if (!unpacked) {
      await this.markRetry(row.envelopeId, now);
      return null;
    }
    return {
      envelopeId: row.envelopeId,
      receivedAt: new Date(row.receivedAt),
      ingestClientId: row.ingestClientId,
      envelope: unpacked.envelope,
      ...(unpacked.identity ? { identity: unpacked.identity } : {})
    };
  }

  async markRetry(envelopeId: string, now: Date): Promise<void> {
    await this.database.query(
      `
        UPDATE ingest_processing
        SET state = 'retrying',
            attempt_count = attempt_count + 1,
            next_attempt_at = $2::timestamptz + INTERVAL '1 minute',
            claimed_at = NULL,
            claimed_by = NULL,
            last_error_code = 'PROCESSING_FAILED'
        WHERE envelope_id = $1 AND state = 'claimed'
      `,
      [envelopeId, now]
    );
  }

  async releaseExpiredClaims(now: Date): Promise<void> {
    await this.database.query(
      `
        UPDATE ingest_processing
        SET state = 'retrying',
            next_attempt_at = $1,
            claimed_at = NULL,
            claimed_by = NULL,
            last_error_code = 'CLAIM_TIMEOUT'
        WHERE state = 'claimed' AND claimed_at < $1::timestamptz - INTERVAL '5 minutes'
      `,
      [now]
    );
  }
}
