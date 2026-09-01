import { randomUUID } from 'node:crypto';

import type { ParameterizedDatabase } from '../../../../../packages/db/src/repositories/opsUsers.js';

export class PostgresSqlElevationRepository {
  constructor(private readonly database: ParameterizedDatabase) {}

  async findActiveTotpFactor(input: {
    userId: string;
    factorId: string;
  }): Promise<{ encryptedSecret: string } | null> {
    const { rows } = await this.database.query<{ encryptedSecret: string }>(
      `
        SELECT convert_from(factor.encrypted_secret, 'UTF8') AS "encryptedSecret"
        FROM ops_mfa_factors AS factor
        JOIN ops_users AS user_record
          ON user_record.id = factor.user_id AND user_record.status = 'active'
        WHERE factor.id = $2 AND factor.user_id = $1
          AND factor.factor_type = 'totp' AND factor.revoked_at IS NULL
        LIMIT 1
      `,
      [input.userId, input.factorId]
    );
    return rows[0] ?? null;
  }

  async grant(input: {
    id: string;
    userId: string;
    sessionId: string;
    factorId: string;
    reason: string;
    grantedAt: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  }): Promise<boolean> {
    const { rows } = await this.database.query<{ granted: boolean }>(
      `
        WITH active_session AS (
          SELECT session.id
          FROM ops_sessions AS session
          JOIN ops_users AS user_record
            ON user_record.id = session.user_id AND user_record.status = 'active'
          JOIN ops_mfa_factors AS factor
            ON factor.id = $4 AND factor.user_id = session.user_id
            AND factor.factor_type = 'totp' AND factor.revoked_at IS NULL
          WHERE session.id = $3 AND session.user_id = $2
            AND session.revoked_at IS NULL
            AND session.idle_expires_at > now() AND session.absolute_expires_at > now()
        ), elevation AS (
          INSERT INTO ops_sql_elevations (
            session_id, user_id, mfa_factor_id, reason,
            granted_at, last_activity_at, idle_expires_at, absolute_expires_at
          )
          SELECT id, $2, $4, $5, $6, $6, $7, $8 FROM active_session
          ON CONFLICT (session_id) DO UPDATE
            SET user_id = EXCLUDED.user_id,
                mfa_factor_id = EXCLUDED.mfa_factor_id,
                reason = EXCLUDED.reason,
                granted_at = EXCLUDED.granted_at,
                last_activity_at = EXCLUDED.last_activity_at,
                idle_expires_at = EXCLUDED.idle_expires_at,
                absolute_expires_at = EXCLUDED.absolute_expires_at,
                revoked_at = NULL
          RETURNING session_id
        ), elevation_event AS (
          INSERT INTO ops_elevation_events (
            id, user_id, session_id, occurred_at, action, reason, mfa_factor_id, expires_at
          )
          SELECT $1, $2, session_id, $6, 'granted', $5, $4, $8 FROM elevation
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM elevation_event) AS granted
      `,
      [
        input.id,
        input.userId,
        input.sessionId,
        input.factorId,
        input.reason,
        input.grantedAt,
        input.idleExpiresAt,
        input.absoluteExpiresAt
      ]
    );
    return rows[0]?.granted === true;
  }

  async consumeActive(input: {
    userId: string;
    sessionId: string;
  }): Promise<{ idleExpiresAt: string; absoluteExpiresAt: string } | null> {
    const { rows } = await this.database.query<{
      idleExpiresAt: string;
      absoluteExpiresAt: string;
    }>(
      `
        UPDATE ops_sql_elevations
        SET last_activity_at = now(),
            idle_expires_at = LEAST(now() + interval '15 minutes', absolute_expires_at)
        WHERE session_id = $2 AND user_id = $1 AND revoked_at IS NULL
          AND idle_expires_at > now() AND absolute_expires_at > now()
        RETURNING idle_expires_at::text AS "idleExpiresAt", absolute_expires_at::text AS "absoluteExpiresAt"
      `,
      [input.userId, input.sessionId]
    );
    return rows[0] ?? null;
  }

  async revokeForSession(input: {
    userId: string;
    sessionId: string;
    reason: string;
  }): Promise<void> {
    const eventId = randomUUID();
    await this.database.query(
      `
        WITH revoked AS (
          UPDATE ops_sql_elevations
          SET revoked_at = now()
          WHERE session_id = $2 AND user_id = $1 AND revoked_at IS NULL
          RETURNING session_id, mfa_factor_id
        )
        INSERT INTO ops_elevation_events (id, user_id, session_id, action, reason, mfa_factor_id)
        SELECT $3, $1, session_id, 'revoked', $4, mfa_factor_id FROM revoked
      `,
      [input.userId, input.sessionId, eventId, input.reason]
    );
  }
}
