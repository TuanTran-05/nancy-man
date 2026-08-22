import { createHash } from 'node:crypto';

import type { ParameterizedDatabase } from './opsUsers.js';

export type OpsSessionRecord = {
  id: string;
  userId: string;
  sessionHash: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
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
          id,
          user_id AS "userId",
          session_hash AS "sessionHash",
          last_activity_at AS "lastActivityAt",
          idle_expires_at AS "idleExpiresAt",
          absolute_expires_at AS "absoluteExpiresAt"
        FROM ops_sessions
        WHERE session_hash = $1
          AND revoked_at IS NULL
          AND idle_expires_at > $2
          AND absolute_expires_at > $2
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
}
