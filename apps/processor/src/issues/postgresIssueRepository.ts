import { randomUUID } from 'node:crypto';

import type { NormalizedEvent } from '../normalize/normalizeEvent.js';
import type { IssueProcessorRepository } from './processEnvelope.js';

type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type IssueRow = {
  id: string;
  status: 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'ignored' | 'regressed';
  occurrenceCount: number | string;
  affectedUserCount: number | string;
};

function mapIssue(row: IssueRow): {
  id: string;
  status: IssueRow['status'];
  occurrenceCount: number;
  affectedUserCount: number;
} {
  return {
    id: row.id,
    status: row.status,
    occurrenceCount: Number(row.occurrenceCount),
    affectedUserCount: Number(row.affectedUserCount)
  };
}

export class PostgresIssueRepository implements IssueProcessorRepository {
  constructor(private readonly database: QueryDatabase) {}

  async withTransaction<T>(operation: () => Promise<T>): Promise<T> {
    await this.database.query('BEGIN');
    try {
      const result = await operation();
      await this.database.query('COMMIT');
      return result;
    } catch (error) {
      await this.database.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  async findIssue(fingerprint: string) {
    const { rows } = await this.database.query<IssueRow>(
      `
        SELECT
          id,
          status,
          occurrence_count AS "occurrenceCount",
          affected_user_count AS "affectedUserCount"
        FROM error_issues
        WHERE fingerprint = $1
        FOR UPDATE
      `,
      [fingerprint]
    );
    return rows[0] ? mapIssue(rows[0]) : null;
  }

  async createIssue(input: { fingerprint: string; event: NormalizedEvent }) {
    const id = randomUUID();
    const { rows } = await this.database.query<{ id: string }>(
      `
        INSERT INTO error_issues (
          id,
          fingerprint,
          title,
          error_code,
          exception_type,
          source,
          severity,
          status,
          first_seen_at,
          last_seen_at,
          occurrence_count,
          affected_user_count,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8, $8, 0, 0, $9::jsonb)
        ON CONFLICT (fingerprint) DO NOTHING
        RETURNING id
      `,
      [
        id,
        input.fingerprint,
        input.event.safeMessage,
        input.event.errorCode,
        input.event.exceptionType,
        input.event.source,
        input.event.severity,
        input.event.occurredAt,
        JSON.stringify({ service: input.event.service, release: input.event.release })
      ]
    );
    if (!rows[0]) {
      const issue = await this.findIssue(input.fingerprint);
      if (!issue) throw new Error('Issue insert conflicted but no issue could be locked');
      return { issue, created: false };
    }
    await this.database.query(
      `
        INSERT INTO error_issue_activity (id, issue_id, activity_type, occurred_at, metadata)
        VALUES ($1, $2, 'created', $3, $4::jsonb)
      `,
      [randomUUID(), id, input.event.occurredAt, JSON.stringify({ fingerprint: input.fingerprint })]
    );
    return {
      issue: { id, status: 'new' as const, occurrenceCount: 0, affectedUserCount: 0 },
      created: true
    };
  }

  async insertOccurrence(input: { issueId: string; event: NormalizedEvent }) {
    const { event } = input;
    if (!event.ingestClientId) {
      throw new Error('Normalized event is missing its ingest client identity');
    }
    const { rows } = await this.database.query<{ inserted: boolean }>(
      `
        INSERT INTO error_events (
          id,
          occurred_at,
          received_at,
          event_id,
          issue_id,
          ingest_client_id,
          source,
          severity,
          request_id,
          trace_id,
          user_reference,
          session_hash,
          route,
          error_code,
          exception_type,
          safe_message,
          stack_trace,
          component_stack,
          context,
          breadcrumbs
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb)
        RETURNING true AS inserted
      `,
      [
        randomUUID(),
        event.occurredAt,
        event.receivedAt,
        event.eventId,
        input.issueId,
        event.ingestClientId,
        event.source,
        event.severity,
        event.requestId ?? null,
        event.traceId ?? null,
        event.userRef ?? null,
        event.sessionHash ?? null,
        event.route ?? null,
        event.errorCode,
        event.exceptionType,
        event.safeMessage,
        event.stackTrace ?? null,
        event.componentStack ?? null,
        JSON.stringify({ service: event.service, release: event.release, tags: event.tags }),
        JSON.stringify(event.breadcrumbs)
      ]
    );
    if (!rows[0]?.inserted) return { inserted: false, newAffectedUser: false };
    if (!event.userRef) return { inserted: true, newAffectedUser: false };
    const affected = await this.database.query<{ userReference: string }>(
      `
        INSERT INTO error_issue_affected_users (issue_id, user_reference, first_seen_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (issue_id, user_reference) DO NOTHING
        RETURNING user_reference AS "userReference"
      `,
      [input.issueId, event.userRef, event.occurredAt]
    );
    return { inserted: true, newAffectedUser: Boolean(affected.rows[0]) };
  }

  async updateIssue(input: {
    issueId: string;
    status: 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'ignored' | 'regressed';
    occurrenceCount: number;
    affectedUserCount: number;
    lastSeenAt: Date;
  }): Promise<void> {
    await this.database.query(
      `
        UPDATE error_issues
        SET status = $2,
            occurrence_count = $3,
            affected_user_count = $4,
            last_seen_at = $5
        WHERE id = $1
      `,
      [
        input.issueId,
        input.status,
        input.occurrenceCount,
        input.affectedUserCount,
        input.lastSeenAt
      ]
    );
  }

  async appendActivity(input: {
    issueId: string;
    activityType: 'regressed';
    occurredAt: Date;
  }): Promise<void> {
    await this.database.query(
      `
        INSERT INTO error_issue_activity (id, issue_id, activity_type, occurred_at, metadata)
        VALUES ($1, $2, $3, $4, '{}'::jsonb)
      `,
      [randomUUID(), input.issueId, input.activityType, input.occurredAt]
    );
  }

  async markProcessed(envelopeId: string): Promise<void> {
    await this.database.query(
      `
        UPDATE ingest_processing
        SET state = 'processed', processed_at = now(), claimed_by = NULL
        WHERE envelope_id = $1 AND state = 'claimed'
      `,
      [envelopeId]
    );
  }
}
