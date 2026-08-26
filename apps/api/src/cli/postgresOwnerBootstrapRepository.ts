import { randomUUID } from 'node:crypto';
import type { ParameterizedDatabase } from '../../../../packages/db/src/repositories/opsUsers.js';
import type { OwnerBootstrapRepository, PendingOwnerInput } from './bootstrapOwner.js';
export class PostgresOwnerBootstrapRepository implements OwnerBootstrapRepository {
  constructor(private readonly database: ParameterizedDatabase) {}
  async countActiveOwners(): Promise<number> {
    const { rows } = await this.database.query<{ count: number | string }>(
      `SELECT count(*) AS count FROM ops_users WHERE role = 'ops_owner' AND status = 'active'`
    );
    return Number(rows[0]?.count ?? 0);
  }
  async createPendingOwner(owner: PendingOwnerInput): Promise<{ id: string }> {
    const userId = randomUUID();
    const expiry = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    const { rows } = await this.database.query<{ id: string }>(
      `WITH owner_row AS (INSERT INTO ops_users (id, username, email, display_name, role, status) VALUES ($1,$2,$3,$4,'ops_owner','pending_mfa') RETURNING id), credential AS (INSERT INTO ops_password_credentials (id,user_id,password_hash,password_fingerprint) SELECT $5,id,$6,$7 FROM owner_row), enrollment AS (INSERT INTO ops_mfa_enrollment_tokens (id,user_id,token_hash,purpose,expires_at) SELECT $8,id,$9,'bootstrap',$10 FROM owner_row) SELECT id FROM owner_row`,
      [
        userId,
        owner.username,
        owner.email,
        owner.displayName,
        randomUUID(),
        owner.passwordHash,
        owner.passwordFingerprint,
        randomUUID(),
        owner.enrollmentTokenHash,
        expiry
      ]
    );
    if (!rows[0]) throw new Error('Could not create pending owner');
    return rows[0];
  }
}
