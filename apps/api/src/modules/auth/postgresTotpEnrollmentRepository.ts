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
  async findPendingFactor(input: {
    userId: string;
    tokenHash: string;
    factorId: string;
  }): Promise<string | null> {
    const { rows } = await this.database.query<{ encryptedSecret: string }>(
      `SELECT encode(factor.encrypted_secret,'base64') AS "encryptedSecret" FROM ops_mfa_factors AS factor JOIN ops_mfa_enrollment_tokens AS token ON token.user_id=factor.user_id WHERE factor.id=$3 AND factor.user_id=$1 AND token.token_hash=$2 AND token.used_at IS NULL AND token.expires_at>now()`,
      [input.userId, input.tokenHash, input.factorId]
    );
    const encoded = rows[0]?.encryptedSecret;
    return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : null;
  }
  async activate(input: {
    userId: string;
    tokenHash: string;
    factorId: string;
    passwordHash: string;
    passwordFingerprint: string;
  }): Promise<boolean> {
    const { rows } = await this.database.query<{ id: string }>(
      `WITH valid_factor AS (SELECT id, user_id FROM ops_mfa_factors WHERE id=$3 AND user_id=$1 AND factor_type='totp' AND revoked_at IS NULL), consumed AS (UPDATE ops_mfa_enrollment_tokens SET used_at=now() WHERE user_id=$1 AND token_hash=$2 AND used_at IS NULL AND expires_at>now() AND EXISTS (SELECT 1 FROM valid_factor) RETURNING user_id), superseded_credentials AS (UPDATE ops_password_credentials SET superseded_at=now() WHERE user_id IN (SELECT user_id FROM consumed) AND superseded_at IS NULL RETURNING user_id), superseded_factors AS (UPDATE ops_mfa_factors SET revoked_at=now() WHERE user_id IN (SELECT user_id FROM consumed) AND revoked_at IS NULL AND id <> $3 RETURNING user_id), active AS (UPDATE ops_users SET status='active' WHERE id IN (SELECT user_id FROM consumed) AND status='pending_mfa' RETURNING id), credential AS (INSERT INTO ops_password_credentials (id,user_id,password_hash,password_fingerprint) SELECT gen_random_uuid(), id, $4, $5 FROM active RETURNING user_id), factor AS (UPDATE ops_mfa_factors SET last_used_at=now(), revoked_at=NULL WHERE id=$3 AND user_id IN (SELECT id FROM active) RETURNING id) SELECT id FROM factor`,
      [input.userId, input.tokenHash, input.factorId, input.passwordHash, input.passwordFingerprint]
    );
    return rows.length === 1;
  }
}
