import { randomUUID } from 'node:crypto';

import type { ParameterizedDatabase } from '../../../../../packages/db/src/repositories/opsUsers.js';

import type { OpsAuthRepository, PasswordCredential, TotpChallenge } from './authService.js';

type CredentialRow = Omit<PasswordCredential, 'mfaFactors'> & { mfaFactors: unknown };

function factors(value: unknown): PasswordCredential['mfaFactors'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((factor) => {
    if (
      typeof factor === 'object' &&
      factor !== null &&
      typeof factor.id === 'string' &&
      factor.type === 'totp' &&
      typeof factor.label === 'string'
    ) {
      return [{ id: factor.id, type: 'totp' as const, label: factor.label }];
    }
    return [];
  });
}

export class PostgresOpsAuthRepository implements OpsAuthRepository {
  constructor(private readonly database: ParameterizedDatabase) {}

  async findPasswordCredential(identifier: string): Promise<PasswordCredential | null> {
    const { rows } = await this.database.query<CredentialRow>(
      `
        SELECT
          user_record.id,
          user_record.username,
          user_record.display_name AS "displayName",
          user_record.role,
          user_record.status,
          credential.password_hash AS "passwordHash",
          COALESCE(
            jsonb_agg(
              jsonb_build_object('id', factor.id, 'type', factor.factor_type, 'label', factor.label)
            ) FILTER (WHERE factor.id IS NOT NULL),
            '[]'::jsonb
          ) AS "mfaFactors"
        FROM ops_users AS user_record
        JOIN LATERAL (
          SELECT password_hash
          FROM ops_password_credentials
          WHERE user_id = user_record.id AND superseded_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC
          LIMIT 1
        ) AS credential ON true
        LEFT JOIN ops_mfa_factors AS factor
          ON factor.user_id = user_record.id AND factor.revoked_at IS NULL
        WHERE lower(user_record.username) = lower($1) OR lower(user_record.email) = lower($1)
        GROUP BY user_record.id, credential.password_hash
        LIMIT 1
      `,
      [identifier]
    );
    const row = rows[0];
    return row ? { ...row, mfaFactors: factors(row.mfaFactors) } : null;
  }

  async recordLoginEvent(
    input: Parameters<OpsAuthRepository['recordLoginEvent']>[0]
  ): Promise<void> {
    await this.database.query(
      `
        INSERT INTO ops_login_events (id, user_id, outcome, ip_hash, user_agent, reason_code)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        randomUUID(),
        input.userId ?? null,
        input.outcome,
        input.ipHash,
        input.userAgent,
        input.reasonCode
      ]
    );
    if (input.outcome !== 'failed' || !input.userId) return;
    const { rows } = await this.database.query<{ id: string }>(
      `
        UPDATE ops_users
        SET status = 'locked', locked_until = now() + interval '30 minutes'
        WHERE id = $1 AND status = 'active'
          AND (
            SELECT count(*) FROM ops_login_events
            WHERE user_id = $1 AND outcome = 'failed'
              AND occurred_at >= now() - interval '15 minutes'
          ) >= 5
        RETURNING id
      `,
      [input.userId]
    );
    if (rows.length > 0) {
      await this.database.query(
        `INSERT INTO ops_login_events (id, user_id, outcome, ip_hash, user_agent, reason_code)
         VALUES ($1, $2, 'locked', $3, $4, 'FAILED_LOGIN_THRESHOLD')`,
        [randomUUID(), input.userId, input.ipHash, input.userAgent]
      );
    }
  }

  async createMfaChallenge(
    input: Parameters<OpsAuthRepository['createMfaChallenge']>[0]
  ): Promise<void> {
    await this.database.query(
      `
        INSERT INTO ops_mfa_login_challenges
          (id, user_id, challenge_hash, expires_at, ip_hash, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [input.id, input.userId, input.challengeHash, input.expiresAt, input.ipHash, input.userAgent]
    );
  }

  async findTotpChallenge(
    input: Parameters<OpsAuthRepository['findTotpChallenge']>[0]
  ): Promise<TotpChallenge | null> {
    const { rows } = await this.database.query<TotpChallenge>(
      `
        SELECT
          challenge.id,
          challenge.user_id AS "userId",
          user_record.role,
          encode(factor.encrypted_secret, 'base64') AS "encryptedTotpSecret"
        FROM ops_mfa_login_challenges AS challenge
        JOIN ops_users AS user_record ON user_record.id = challenge.user_id
        JOIN ops_mfa_factors AS factor
          ON factor.id = $2 AND factor.user_id = challenge.user_id
          AND factor.factor_type = 'totp' AND factor.revoked_at IS NULL
        WHERE challenge.challenge_hash = $1 AND challenge.ip_hash = $3
          AND challenge.used_at IS NULL AND challenge.expires_at > now()
          AND user_record.status = 'active'
        LIMIT 1
      `,
      [input.challengeHash, input.factorId, input.ipHash]
    );
    return rows[0] ?? null;
  }

  async consumeMfaChallengeAndCreateSession(
    input: Parameters<OpsAuthRepository['consumeMfaChallengeAndCreateSession']>[0]
  ): Promise<boolean> {
    const { rows } = await this.database.query<{ authenticated: boolean }>(
      `
        WITH consumed_challenge AS (
          UPDATE ops_mfa_login_challenges
          SET used_at = now()
          WHERE challenge_hash = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id
        ), created_session AS (
          INSERT INTO ops_sessions (
            id, user_id, session_hash, csrf_secret_hash, idle_expires_at, absolute_expires_at, ip_hash, user_agent
          )
          SELECT $3, user_id, $4, $5, $6, $7, $8, $9 FROM consumed_challenge
          RETURNING user_id
        ), updated_user AS (
          UPDATE ops_users SET last_login_at = now()
          WHERE id IN (SELECT user_id FROM created_session)
          RETURNING id
        ), login_event AS (
          INSERT INTO ops_login_events (id, user_id, outcome, ip_hash, user_agent, reason_code)
          SELECT $10, id, 'succeeded', $8, $9, 'MFA_VERIFIED' FROM updated_user
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM login_event) AS authenticated
      `,
      [
        input.challengeHash,
        input.userId,
        input.sessionId,
        input.sessionHash,
        input.csrfSecretHash,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.ipHash,
        input.userAgent,
        input.loginEventId
      ]
    );
    return rows[0]?.authenticated === true;
  }
}
