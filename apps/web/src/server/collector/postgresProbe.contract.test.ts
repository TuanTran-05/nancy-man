import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createPostgresContractClient } from './postgresContractTarget.js';

const client = createPostgresContractClient(
  process.env,
  (connectionString) => new Client({ connectionString })
);

describe.skipIf(!client)('ops_monitor PostgreSQL contract', () => {
  it('can execute the aggregate but has no public DDL/DML capability', async () => {
    await client!.connect();
    try {
      const snapshot = await client!.query('SELECT ops_metrics.snapshot() AS snapshot');
      expect(snapshot.rows[0]?.snapshot).toBeTruthy();
      const privileges = await client!.query(`
        SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
               has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
               current_user IN (SELECT member::regrole::text FROM pg_auth_members WHERE roleid = 'ops_monitor'::regrole) AS unexpected_membership
      `);
      expect(privileges.rows[0]).toMatchObject({
        can_create_database: false,
        can_create_public: false,
        unexpected_membership: false
      });
      await expect(
        client!.query('CREATE TABLE public.ops_monitor_contract_forbidden (id integer)')
      ).rejects.toThrow();
    } finally {
      await client!.end();
    }
  });
});
