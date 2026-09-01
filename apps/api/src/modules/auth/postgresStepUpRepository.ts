import type { ParameterizedDatabase } from '../../../../../packages/db/src/repositories/opsUsers.js';

import type {
  StepUpBinding,
  StepUpCapability,
  StepUpGrant,
  StepUpRepository
} from './stepUpService.js';

type GrantRow = Omit<StepUpGrant, 'reusable'> & { reusable: boolean };

export class PostgresStepUpRepository implements StepUpRepository {
  constructor(private readonly database: ParameterizedDatabase) {}

  async findProof(input: {
    userId: string;
    factorId: string;
  }): Promise<{ passwordHash: string; encryptedTotpSecret: string } | null> {
    const { rows } = await this.database.query<{
      passwordHash: string;
      encryptedTotpSecret: string;
    }>(
      `
        SELECT credential.password_hash AS "passwordHash",
               convert_from(factor.encrypted_secret, 'UTF8') AS "encryptedTotpSecret"
        FROM ops_users AS user_record
        JOIN LATERAL (
          SELECT password_hash
          FROM ops_password_credentials
          WHERE user_id = user_record.id AND superseded_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC
          LIMIT 1
        ) AS credential ON true
        JOIN ops_mfa_factors AS factor
          ON factor.user_id = user_record.id AND factor.id = $2
          AND factor.factor_type = 'totp' AND factor.revoked_at IS NULL
        WHERE user_record.id = $1 AND user_record.status = 'active'
        LIMIT 1
      `,
      [input.userId, input.factorId]
    );
    return rows[0] ?? null;
  }

  async findParentSession(input: {
    userId: string;
    sessionId: string;
  }): Promise<{ absoluteExpiresAt: string } | null> {
    const { rows } = await this.database.query<{ absoluteExpiresAt: string }>(
      `
        SELECT absolute_expires_at::text AS "absoluteExpiresAt"
        FROM ops_sessions
        WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL
          AND idle_expires_at > now() AND absolute_expires_at > now()
        LIMIT 1
      `,
      [input.userId, input.sessionId]
    );
    return rows[0] ?? null;
  }

  async replaceOlder(input: {
    userId: string;
    sessionId: string;
    capability: StepUpCapability;
    subjectDigest: string | null;
  }): Promise<void> {
    await this.database.query(
      `
        UPDATE ops_secret_elevations
        SET revoked_at = now()
        WHERE user_id = $1 AND session_id = $2 AND capability = $3
          AND revoked_at IS NULL AND consumed_at IS NULL
          AND COALESCE(subject_digest, '') = COALESCE($4, '')
      `,
      [input.userId, input.sessionId, input.capability, input.subjectDigest]
    );
  }

  async insert(grant: StepUpGrant): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `
        INSERT INTO ops_secret_elevations (
          id, capability, user_id, session_id, ip_hash, user_agent_hash,
          subject_digest, granted_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `,
      [
        grant.id,
        grant.capability,
        grant.userId,
        grant.sessionId,
        grant.ipHash,
        grant.userAgentHash,
        grant.subjectDigest,
        grant.grantedAt,
        grant.expiresAt
      ]
    );
    return rows.length > 0;
  }

  async authorize(input: StepUpBinding): Promise<StepUpGrant | null> {
    const { rows } = await this.database.query<GrantRow>(
      `
        UPDATE ops_secret_elevations
        SET last_used_at = now()
        WHERE id = $1 AND capability = $2 AND user_id = $3 AND session_id = $4
          AND ip_hash = $5 AND user_agent_hash = $6
          AND COALESCE(subject_digest, '') = COALESCE($7, '')
          AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > now()
        RETURNING id, capability, user_id AS "userId", session_id AS "sessionId",
          ip_hash AS "ipHash", user_agent_hash AS "userAgentHash",
          subject_digest AS "subjectDigest", granted_at AS "grantedAt",
          expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
          consumed_at AS "consumedAt", revoked_at AS "revokedAt",
          (capability = 'variables_secret') AS reusable
      `,
      [
        input.grantId,
        input.capability,
        input.userId,
        input.sessionId,
        input.ipHash,
        input.userAgentHash,
        input.subjectDigest ?? null
      ]
    );
    return rows[0] ?? null;
  }

  async consume(input: StepUpBinding): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `
        UPDATE ops_secret_elevations
        SET consumed_at = now()
        WHERE id = $1 AND capability = $2 AND user_id = $3 AND session_id = $4
          AND ip_hash = $5 AND user_agent_hash = $6
          AND COALESCE(subject_digest, '') = COALESCE($7, '')
          AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
          AND capability IN ('accounts_write', 'variables_apply')
        RETURNING id
      `,
      [
        input.grantId,
        input.capability,
        input.userId,
        input.sessionId,
        input.ipHash,
        input.userAgentHash,
        input.subjectDigest ?? null
      ]
    );
    return rows.length > 0;
  }

  async revoke(input: StepUpBinding): Promise<void> {
    await this.database.query(
      `
        UPDATE ops_secret_elevations
        SET revoked_at = now()
        WHERE id = $1 AND capability = $2 AND user_id = $3 AND session_id = $4
          AND ip_hash = $5 AND user_agent_hash = $6 AND revoked_at IS NULL
      `,
      [
        input.grantId,
        input.capability,
        input.userId,
        input.sessionId,
        input.ipHash,
        input.userAgentHash
      ]
    );
  }
}
