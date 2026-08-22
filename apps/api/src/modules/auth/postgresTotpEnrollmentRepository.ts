import type { ParameterizedDatabase } from '../../../../../packages/db/src/repositories/opsUsers.js';
export class PostgresTotpEnrollmentRepository {
  constructor(private readonly database: ParameterizedDatabase) {}
  async createPendingFactor(input: {
    userId: string;
    tokenHash: string;
    factorId: string;
    encryptedSecret: string;
  }): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `WITH valid_token AS (SELECT token.user_id FROM ops_mfa_enrollment_tokens AS token JOIN ops_users AS user_record ON user_record.id=token.user_id AND user_record.status='pending_mfa' WHERE token.user_id=$1 AND token.token_hash=$2 AND token.used_at IS NULL AND token.expires_at>now()), factor AS (INSERT INTO ops_mfa_factors (id,user_id,factor_type,encrypted_secret,label) SELECT $3,user_id,'totp',convert_to($4,'utf8'),'Authenticator app' FROM valid_token RETURNING id) SELECT id FROM factor`,
      [input.userId, input.tokenHash, input.factorId, input.encryptedSecret]
    );
    return rows.length === 1;
  }
  async activate(input: { userId: string; tokenHash: string; factorId: string }): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `WITH consumed AS (UPDATE ops_mfa_enrollment_tokens SET used_at=now() WHERE user_id=$1 AND token_hash=$2 AND used_at IS NULL AND expires_at>now() RETURNING user_id), active AS (UPDATE ops_users SET status='active' WHERE id IN (SELECT user_id FROM consumed) AND status='pending_mfa' RETURNING id), factor AS (UPDATE ops_mfa_factors SET last_used_at=now() WHERE id=$3 AND user_id IN (SELECT id FROM active) RETURNING id) SELECT id FROM factor`,
      [input.userId, input.tokenHash, input.factorId]
    );
    return rows.length === 1;
  }
}
