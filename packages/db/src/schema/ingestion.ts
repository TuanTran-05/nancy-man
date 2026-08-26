import {
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

import { pgTable } from 'drizzle-orm/pg-core';

type JsonObject = Record<string, unknown>;

export const ingestClients = pgTable(
  'ingest_clients',
  {
    id: uuid('id').primaryKey(),
    clientName: text('client_name').notNull(),
    clientKind: text('client_kind')
      .$type<'browser' | 'server' | 'worker' | 'synthetic'>()
      .notNull(),
    serviceName: text('service_name').notNull(),
    status: text('status').$type<'active' | 'disabled' | 'rotated'>().notNull(),
    publicKeyId: text('public_key_id'),
    secretReference: text('secret_reference'),
    allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('ingest_clients_service_status_idx').on(table.serviceName, table.status)]
);

export const ingestIdempotency = pgTable(
  'ingest_idempotency',
  {
    ingestClientId: uuid('ingest_client_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    eventId: text('event_id').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow().notNull(),
    payloadHash: text('payload_hash').notNull()
  },
  (table) => [primaryKey({ columns: [table.ingestClientId, table.idempotencyKey] })]
);

export const ingestEnvelopes = pgTable(
  'ingest_envelopes',
  {
    id: uuid('id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    ingestClientId: uuid('ingest_client_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    eventId: text('event_id').notNull(),
    source: text('source')
      .$type<
        | 'browser'
        | 'api'
        | 'database'
        | 'document_store'
        | 'job'
        | 'provider'
        | 'process'
        | 'deployment'
        | 'synthetic'
      >()
      .notNull(),
    requestId: text('request_id'),
    traceId: text('trace_id'),
    releaseId: uuid('release_id'),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    payloadHash: text('payload_hash').notNull(),
    redacted: boolean('redacted').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.id, table.receivedAt] }),
    index('ingest_envelopes_event_received_idx').on(table.eventId, table.receivedAt),
    index('ingest_envelopes_client_received_idx').on(table.ingestClientId, table.receivedAt)
  ]
);

export const ingestProcessing = pgTable(
  'ingest_processing',
  {
    envelopeId: uuid('envelope_id').notNull(),
    envelopeReceivedAt: timestamp('envelope_received_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    state: text('state')
      .$type<'pending' | 'claimed' | 'processed' | 'retrying' | 'dead_lettered'>()
      .notNull(),
    attemptCount: integer('attempt_count').notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: text('claimed_by'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    lastErrorDetail: text('last_error_detail')
  },
  (table) => [
    primaryKey({ columns: [table.envelopeId, table.envelopeReceivedAt] }),
    index('ingest_processing_ready_idx').on(table.state, table.nextAttemptAt, table.receivedAt)
  ]
);
