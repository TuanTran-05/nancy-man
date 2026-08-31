import { createHash } from 'node:crypto';

import type { ParameterizedDatabase } from './opsUsers.js';

type OpsRole = 'ops_viewer' | 'ops_maintainer' | 'ops_owner';

export type OpsSessionRecord = {
  id: string;
  userId: string;
  sessionHash: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  csrfSecretHash: string;
  role: OpsRole;
  username?: string;
  displayName?: string;
};

export class OpsSessionRepository {
  constructor(
    private readonly database: ParameterizedDatabase,
    private readonly pepper: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async findActiveByToken(token: string): Promise<OpsSessionRecord | null> {
    const now = this.now();
    const nowIso = now.toISOString();
    const sessionHash = createHash('sha256').update(`${token}${this.pepper}`).digest('hex');
    const { rows } = await this.database.query<OpsSessionRecord>(
      `
        SELECT
          session.id,
          session.user_id AS "userId",
          session.session_hash AS "sessionHash",
          session.csrf_secret_hash AS "csrfSecretHash",
          user_record.username,
          user_record.display_name AS "displayName",
          user_record.role,
          session.last_activity_at AS "lastActivityAt",
          session.idle_expires_at AS "idleExpiresAt",
          session.absolute_expires_at AS "absoluteExpiresAt"
        FROM ops_sessions AS session
        JOIN ops_users AS user_record ON user_record.id = session.user_id AND user_record.status = 'active'
        WHERE session.session_hash = $1
          AND session.revoked_at IS NULL
          AND session.idle_expires_at > $2
          AND session.absolute_expires_at > $2
        LIMIT 1
      `,
      [sessionHash, nowIso]
    );
    const session = rows[0] ?? null;

    if (!session) {
      return null;
    }

    const lastActivity = Date.parse(session.lastActivityAt);
    if (Number.isFinite(lastActivity) && now.getTime() - lastActivity >= 5 * 60 * 1_000) {
      await this.database.query('UPDATE ops_sessions SET last_activity_at = $1 WHERE id = $2', [
        nowIso,
        session.id
      ]);
    }

    return session;
  }

  async revokeById(sessionId: string, reason: string): Promise<void> {
    await this.database.query(
      `UPDATE ops_sessions
       SET revoked_at = now(), revoked_reason = $2
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason]
    );
  }
}
