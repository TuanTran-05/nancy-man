import { randomUUID } from 'node:crypto';

import type { ParameterizedDatabase } from '../../../../../packages/db/src/repositories/opsUsers.js';

import type { AccountRepository, OpsAccountSummary } from './accountService.js';

type QueryDatabase = ParameterizedDatabase;
type TransactionalDatabase = QueryDatabase & {
  transaction: <T>(operation: (database: QueryDatabase) => Promise<T>) => Promise<T>;
};

type AccountRow = OpsAccountSummary;

function accountQuery() {
  return `
    SELECT user_record.id, user_record.username, user_record.email,
      user_record.display_name AS "displayName", user_record.role, user_record.status,
      EXISTS (
        SELECT 1 FROM ops_mfa_factors factor
        WHERE factor.user_id = user_record.id AND factor.factor_type = 'totp'
          AND factor.revoked_at IS NULL
      ) AS "mfaEnrolled",
      user_record.created_at AS "createdAt", user_record.last_login_at AS "lastLoginAt"
    FROM ops_users user_record
  `;
}

async function appendAccountEvent(database: QueryDatabase, input: {
  userId: string;
  actorUserId: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  await database.query(
    `INSERT INTO ops_account_events (id, user_id, actor_user_id, event_type, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [randomUUID(), input.userId, input.actorUserId, input.eventType, JSON.stringify(input.metadata ?? {})]
  );
}

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly database: TransactionalDatabase) {}

  async list(): Promise<readonly OpsAccountSummary[]> {
    const { rows } = await this.database.query<AccountRow>(`${accountQuery()} ORDER BY user_record.created_at, user_record.id`);
    return rows;
  }

  async findById(id: string): Promise<OpsAccountSummary | null> {
    const { rows } = await this.database.query<AccountRow>(`${accountQuery()} WHERE user_record.id = $1 LIMIT 1`, [id]);
    return rows[0] ?? null;
  }

  async countActiveOwners(): Promise<number> {
    const { rows } = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ops_users WHERE status = 'active' AND role = 'ops_owner'`
    );
    return Number(rows[0]?.count ?? 0);
  }

  async createPending(input: Parameters<AccountRepository['createPending']>[0]): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const { rows } = await database.query<{ id: string }>(
        `INSERT INTO ops_users (id, username, email, display_name, role, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending_mfa', $6)
         RETURNING id`,
        [input.id, input.username, input.email, input.displayName, input.role, input.createdAt]
      );
      if (rows.length !== 1) return false;
      await database.query(
        `INSERT INTO ops_mfa_enrollment_tokens
          (id, user_id, token_hash, purpose, expires_at, issued_by_user_id)
         VALUES ($1, $2, $3, 'invite', $4, $5)`,
        [randomUUID(), input.id, input.tokenHash, input.expiresAt, input.issuedByUserId]
      );
      await appendAccountEvent(database, {
        userId: input.id,
        actorUserId: input.issuedByUserId,
        eventType: 'created',
        metadata: { role: input.role, status: 'pending_mfa' }
      });
      return true;
    });
  }

  async changeRole(input: Parameters<AccountRepository['changeRole']>[0]): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const account = await this.lockActorAndTarget(database, input.actorUserId, input.targetUserId);
      if (!account || input.actorUserId === input.targetUserId) return false;
      const owners = await this.lockActiveOwnerCount(database);
      if (account.role === 'ops_owner' && account.status === 'active' && input.role !== 'ops_owner' && owners <= 1) return false;
      const { rows } = await database.query<{ id: string }>(
        `UPDATE ops_users SET role = $3 WHERE id = $2 AND $1 <> $2 AND status <> 'revoked' RETURNING id`,
        [input.actorUserId, input.targetUserId, input.role]
      );
      if (rows.length !== 1) return false;
      await appendAccountEvent(database, { userId: input.targetUserId, actorUserId: input.actorUserId, eventType: 'role_changed', metadata: { role: input.role } });
      return true;
    });
  }

  async lock(input: Parameters<AccountRepository['lock']>[0]): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const account = await this.lockActorAndTarget(database, input.actorUserId, input.targetUserId);
      if (!account || input.actorUserId === input.targetUserId) return false;
      if (account.role === 'ops_owner' && account.status === 'active' && (await this.lockActiveOwnerCount(database)) <= 1) return false;
      const { rows } = await database.query<{ id: string }>(
        `UPDATE ops_users
         SET status = 'locked', administratively_locked_at = now(), administratively_locked_by = $1,
             lock_reason = $3, login_blocked_until = NULL
         WHERE id = $2 AND status <> 'revoked' RETURNING id`,
        [input.actorUserId, input.targetUserId, input.reason]
      );
      if (rows.length !== 1) return false;
      await this.revokeAccess(database, input.targetUserId, 'ACCOUNT_LOCKED');
      await appendAccountEvent(database, { userId: input.targetUserId, actorUserId: input.actorUserId, eventType: 'administratively_locked', metadata: { reason: input.reason } });
      return true;
    });
  }

  async recover(input: Parameters<AccountRepository['recover']>[0]): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const account = await this.lockActorAndTarget(database, input.actorUserId, input.targetUserId);
      if (!account || account.status !== 'locked') return false;
      const { rows } = await database.query<{ id: string }>(
        `UPDATE ops_users
         SET status = 'pending_mfa', administratively_locked_at = NULL,
             administratively_locked_by = NULL, lock_reason = NULL, login_blocked_until = NULL
         WHERE id = $2 AND status = 'locked' RETURNING id`,
        [input.actorUserId, input.targetUserId]
      );
      if (rows.length !== 1) return false;
      await this.revokeAccess(database, input.targetUserId, 'ACCOUNT_RECOVERY');
      await database.query(
        `INSERT INTO ops_mfa_enrollment_tokens (id, user_id, token_hash, purpose, expires_at, issued_by_user_id)
         VALUES ($1, $2, $3, 'recovery', $4, $5)`,
        [randomUUID(), input.targetUserId, input.tokenHash, input.expiresAt, input.actorUserId]
      );
      await appendAccountEvent(database, { userId: input.targetUserId, actorUserId: input.actorUserId, eventType: 'recovery_issued', metadata: { status: 'pending_mfa' } });
      return true;
    });
  }

  async revoke(input: Parameters<AccountRepository['revoke']>[0]): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const account = await this.lockActorAndTarget(database, input.actorUserId, input.targetUserId);
      if (!account || input.actorUserId === input.targetUserId) return false;
      if (account.role === 'ops_owner' && account.status === 'active' && (await this.lockActiveOwnerCount(database)) <= 1) return false;
      const { rows } = await database.query<{ id: string }>(
        `UPDATE ops_users SET status = 'revoked', revoked_at = now(), revoked_by = $1 WHERE id = $2 AND status <> 'revoked' RETURNING id`,
        [input.actorUserId, input.targetUserId]
      );
      if (rows.length !== 1) return false;
      await this.revokeAccess(database, input.targetUserId, 'ACCOUNT_REVOKED');
      await appendAccountEvent(database, { userId: input.targetUserId, actorUserId: input.actorUserId, eventType: 'revoked', metadata: { status: 'revoked' } });
      return true;
    });
  }

  private async lockActorAndTarget(database: QueryDatabase, actorUserId: string, targetUserId: string): Promise<OpsAccountSummary | null> {
    await database.query<AccountRow>(`${accountQuery()} WHERE user_record.id IN ($1, $2) FOR UPDATE`, [actorUserId, targetUserId]);
    const { rows } = await database.query<AccountRow>(`${accountQuery()} WHERE user_record.id = $1 LIMIT 1 FOR UPDATE`, [targetUserId]);
    return rows[0] ?? null;
  }

  private async lockActiveOwnerCount(database: QueryDatabase): Promise<number> {
    const { rows } = await database.query<{ count: string }>(`SELECT count(*)::text AS count FROM ops_users WHERE status = 'active' AND role = 'ops_owner' FOR UPDATE`);
    return Number(rows[0]?.count ?? 0);
  }

  private async revokeAccess(database: QueryDatabase, userId: string, reason: string): Promise<void> {
    await database.query(`UPDATE ops_sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [userId, reason]);
    await database.query(`UPDATE ops_mfa_login_challenges SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    await database.query(`UPDATE ops_secret_elevations SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await database.query(`UPDATE ops_mfa_enrollment_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  }
}
