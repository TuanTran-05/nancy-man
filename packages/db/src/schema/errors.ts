import {
  bigint,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

import { pgTable } from 'drizzle-orm/pg-core';

type ErrorSource =
  | 'browser'
  | 'api'
  | 'database'
  | 'document_store'
  | 'job'
  | 'provider'
  | 'process'
  | 'deployment'
  | 'synthetic';
type Severity = 'critical' | 'high' | 'medium' | 'low';
type JsonObject = Record<string, unknown>;

export const errorIssues = pgTable(
  'error_issues',
  {
    id: uuid('id').primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    title: text('title').notNull(),
    errorCode: text('error_code'),
    exceptionType: text('exception_type'),
    source: text('source').$type<ErrorSource>().notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    status: text('status')
      .$type<'new' | 'acknowledged' | 'investigating' | 'resolved' | 'ignored' | 'regressed'>()
      .notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    occurrenceCount: bigint('occurrence_count', { mode: 'number' }).notNull(),
    affectedUserCount: bigint('affected_user_count', { mode: 'number' }).notNull(),
    firstReleaseId: uuid('first_release_id'),
    lastReleaseId: uuid('last_release_id'),
    assignedUserId: uuid('assigned_user_id'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ignoredAt: timestamp('ignored_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('error_issues_inbox_idx').on(table.status, table.severity, table.lastSeenAt)]
);

export const errorEvents = pgTable(
  'error_events',
  {
    id: uuid('id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    eventId: text('event_id').notNull(),
    issueId: uuid('issue_id').notNull(),
    ingestClientId: uuid('ingest_client_id').notNull(),
    source: text('source').$type<ErrorSource>().notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    requestId: text('request_id'),
    traceId: text('trace_id'),
    releaseId: uuid('release_id'),
    userReference: text('user_reference'),
    sessionHash: text('session_hash'),
    route: text('route'),
    method: text('method'),
    httpStatus: integer('http_status'),
    errorCode: text('error_code'),
    exceptionType: text('exception_type'),
    safeMessage: text('safe_message').notNull(),
    stackTrace: text('stack_trace'),
    componentStack: text('component_stack'),
    context: jsonb('context').$type<JsonObject>().notNull(),
    breadcrumbs: jsonb('breadcrumbs').$type<JsonObject[]>().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.id, table.occurredAt] }),
    index('error_events_issue_occurred_idx').on(table.issueId, table.occurredAt),
    index('error_events_event_occurred_idx').on(table.eventId, table.occurredAt)
  ]
);

export const errorIssueActivity = pgTable(
  'error_issue_activity',
  {
    id: uuid('id').primaryKey(),
    issueId: uuid('issue_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    activityType: text('activity_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    comment: text('comment'),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('error_issue_activity_issue_occurred_idx').on(table.issueId, table.occurredAt)]
);

export const errorIssueAffectedUsers = pgTable(
  'error_issue_affected_users',
  {
    issueId: uuid('issue_id').notNull(),
    userReference: text('user_reference').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull()
  },
  (table) => [primaryKey({ columns: [table.issueId, table.userReference] })]
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey(),
    incidentKey: text('incident_key').notNull(),
    title: text('title').notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    status: text('status').$type<'open' | 'mitigated' | 'resolved'>().notNull(),
    declaredByUserId: uuid('declared_by_user_id'),
    declaredAt: timestamp('declared_at', { withTimezone: true }).defaultNow().notNull(),
    mitigatedAt: timestamp('mitigated_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    summary: text('summary'),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('incidents_status_declared_idx').on(table.status, table.declaredAt)]
);

export const incidentIssues = pgTable(
  'incident_issues',
  {
    incidentId: uuid('incident_id').notNull(),
    issueId: uuid('issue_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
    linkedByUserId: uuid('linked_by_user_id')
  },
  (table) => [primaryKey({ columns: [table.incidentId, table.issueId] })]
);

export const ingestDeadLetters = pgTable(
  'ingest_dead_letters',
  {
    id: uuid('id').primaryKey(),
    envelopeId: uuid('envelope_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    failureCode: text('failure_code').notNull(),
    failureDetail: text('failure_detail'),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    retryCount: integer('retry_count').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    metadata: jsonb('metadata').$type<JsonObject>().notNull()
  },
  (table) => [index('ingest_dead_letters_open_idx').on(table.receivedAt)]
);
