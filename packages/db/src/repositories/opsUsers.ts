export type ParameterizedDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

export type OpsUserRecord = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: 'ops_viewer' | 'ops_maintainer' | 'ops_owner';
  status: 'pending_mfa' | 'active' | 'locked' | 'revoked';
};

export class OpsUserRepository {
  constructor(private readonly database: ParameterizedDatabase) {}

  async findByIdentifier(identifier: string): Promise<OpsUserRecord | null> {
    const { rows } = await this.database.query<OpsUserRecord>(
      `
        SELECT
          id,
          username,
          email,
          display_name AS "displayName",
          role,
          status
        FROM ops_users
        WHERE lower(username) = lower($1) OR lower(email) = lower($1)
        LIMIT 1
      `,
      [identifier]
    );

    return rows[0] ?? null;
  }
}
