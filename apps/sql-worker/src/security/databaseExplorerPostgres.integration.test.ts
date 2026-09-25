import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  DatabaseRowsRequest,
  DatabaseRowsResponse
} from '../../../../packages/contracts/src/databaseExplorer.js';
import {
  integrationActor,
  runTargetControl,
  startPostgresWorkerFixture,
  type PostgresWorkerFixture
} from './databaseExplorerPostgres.fixture.js';
import { readProductionSchema } from '../schema/introspectSchema.js';

describe('Database Explorer against isolated PostgreSQL 16', () => {
  let fixture: PostgresWorkerFixture;

  beforeAll(async () => {
    fixture = await startPostgresWorkerFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

  async function rows(
    input: Partial<DatabaseRowsRequest> & Pick<DatabaseRowsRequest, 'targetId' | 'relation'>
  ) {
    return fixture.client.command({
      actor: integrationActor,
      kind: 'database.rows',
      payload: {
        targetId: input.targetId,
        schema: input.schema ?? 'public',
        relation: input.relation,
        pageSize: input.pageSize ?? 25,
        filters: input.filters ?? [],
        piiMode: input.piiMode ?? 'masked',
        ...(input.sort ? { sort: input.sort } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {})
      } satisfies DatabaseRowsRequest
    });
  }

  function responseRows(response: Awaited<ReturnType<typeof rows>>): DatabaseRowsResponse {
    if (!response.ok) throw new Error(`Worker request failed: ${response.error.code}`);
    return response.result as DatabaseRowsResponse;
  }

  async function integrity(targetId: 'edutrack_production' | 'ops') {
    const pool = fixture.adminPools[targetId];
    const schema = await readProductionSchema({ database: pool });
    const rowsResult = await pool.query<{ rows: unknown }>(
      `SELECT COALESCE(json_agg(to_jsonb(fixture_row) ORDER BY id), '[]'::json) AS rows
       FROM public.explorer_rows AS fixture_row`
    );
    const studentsResult = await pool.query<{ rows: unknown }>(
      `SELECT COALESCE(json_agg(to_jsonb(fixture_student) ORDER BY tenant_id, student_id), '[]'::json) AS rows
       FROM public.explorer_students AS fixture_student`
    );
    return {
      schema: schema.checksum,
      data: createHash('sha256')
        .update(JSON.stringify([rowsResult.rows[0]?.rows, studentsResult.rows[0]?.rows]))
        .digest('hex')
    };
  }

  async function mustRejectInRollbackTransaction(client: PoolClient, sql: string): Promise<void> {
    await client.query('BEGIN');
    let errorCode: string | undefined;
    try {
      await client.query(sql);
    } catch (error) {
      errorCode = (error as { code?: string }).code;
    }
    await client.query('ROLLBACK');
    expect(errorCode, `expected PostgreSQL ACL rejection for: ${sql.split(' ', 1)[0]}`).toBe(
      '42501'
    );
  }

  async function targets() {
    const response = await fixture.client.command({
      actor: integrationActor,
      kind: 'database.targets',
      payload: {}
    });
    if (!response.ok) throw new Error(`Target health request failed: ${response.error.code}`);
    return response.result as Array<{ id: string; status: string }>;
  }

  it('reads approved columns through the worker using the SCRAM login and blocks protected values', async () => {
    const response = await rows({ targetId: 'edutrack_production', relation: 'explorer_rows' });
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const result = responseRows(response);
    expect(result.rows).toHaveLength(25);
    expect(result.columns.find((column) => column.name === 'blocked_token')).toMatchObject({
      classification: 'blocked',
      selectable: false
    });
    expect(result.rows[0]?.cells['safe_value']).toMatchObject({
      state: 'value',
      value: 'safe-edutrack_production-1'
    });
    expect(result.rows[0]?.cells['blocked_token']).toEqual({ state: 'blocked' });
    expect(JSON.stringify(response)).not.toContain('BLOCKED-SECRET-');
  });

  it('leaves exactly the expected capability membership and removes stale admin CASCADE paths', async () => {
    for (const targetId of ['edutrack_production', 'ops'] as const) {
      const target = fixture.config.targets[targetId];
      const result = await fixture.adminPools[targetId].query<{
        members: string[];
        login_members: string[];
        expected_membership: boolean;
        stale_path: boolean;
      }>(
        `SELECT
           array_to_json(ARRAY(
             SELECT member_role.rolname
             FROM pg_auth_members edge
             JOIN pg_roles granted_role ON granted_role.oid = edge.roleid
             JOIN pg_roles member_role ON member_role.oid = edge.member
             WHERE granted_role.rolname = 'ops_database_browser'
             ORDER BY member_role.rolname
           )) AS members,
           array_to_json(ARRAY(
             SELECT granted_role.rolname
             FROM pg_auth_members edge
             JOIN pg_roles member_role ON member_role.oid = edge.member
             JOIN pg_roles granted_role ON granted_role.oid = edge.roleid
             WHERE member_role.rolname = $1
             ORDER BY granted_role.rolname
           )) AS login_members,
           EXISTS (
             SELECT 1
             FROM pg_auth_members edge
             JOIN pg_roles granted_role ON granted_role.oid = edge.roleid
             JOIN pg_roles member_role ON member_role.oid = edge.member
             WHERE granted_role.rolname = 'ops_database_browser'
               AND member_role.rolname = $1
               AND edge.inherit_option AND NOT edge.set_option AND NOT edge.admin_option
           ) AS expected_membership,
           pg_has_role('explorer_stale_capability_dependent', 'ops_database_browser', 'member')
             AS stale_path`,
        [target.login]
      );
      expect(result.rows).toEqual([
        {
          members: [target.login],
          login_members: ['ops_database_browser'],
          expected_membership: true,
          stale_path: false
        }
      ]);
    }
  });

  it('enforces actual login ACLs and read-only transaction boundaries without changing fixture state', async () => {
    for (const targetId of ['edutrack_production', 'ops'] as const) {
      const target = fixture.config.targets[targetId];
      const before = await integrity(targetId);
      const client = await fixture.browserPools[targetId].connect();
      try {
        const identity = await client.query<{
          role: string;
          database: string;
          ssl: boolean;
        }>(
          `SELECT current_user AS role, current_database() AS database,
                  (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`
        );
        expect(identity.rows).toEqual([
          {
            role: target.login,
            database: target.databaseName,
            ssl: true
          }
        ]);

        const safeRead = await client.query<{ safe_value: string }>(
          'SELECT safe_value FROM public.explorer_rows WHERE id = 1'
        );
        expect(safeRead.rows).toEqual([{ safe_value: `safe-${targetId}-1` }]);

        let blockedReadErrorCode: string | undefined;
        try {
          await client.query('SELECT blocked_token FROM public.explorer_rows WHERE id = 1');
        } catch (error) {
          blockedReadErrorCode = (error as { code?: string }).code;
        }
        expect(blockedReadErrorCode).toBe('42501');

        // Disable the role-level default to prove the ACL itself is SELECT-only.
        await client.query('SET SESSION default_transaction_read_only = off');
        expect(
          (
            await client.query<{ value: string }>(
              "SELECT current_setting('default_transaction_read_only') AS value"
            )
          ).rows[0]?.value
        ).toBe('off');

        const functionName = `task7_probe_${Date.now()}`;
        const prohibitedStatements = [
          `INSERT INTO public.explorer_rows (id, safe_value, tenant_id, student_id) VALUES (9999, 'insert-probe', '${targetId}', 9999)`,
          "UPDATE public.explorer_rows SET safe_value = 'update-probe' WHERE id = 1",
          'DELETE FROM public.explorer_rows WHERE id = 1',
          'TRUNCATE public.explorer_rows',
          'CREATE TEMP TABLE task7_temp_probe (id integer)',
          `CREATE FUNCTION public.${functionName}() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
          "COPY (SELECT safe_value FROM public.explorer_rows LIMIT 0) TO PROGRAM 'true'",
          'SET ROLE ops_database_browser'
        ];
        for (const sql of prohibitedStatements) {
          await mustRejectInRollbackTransaction(client, sql);
        }
        expect(
          (await client.query<{ role: string }>('SELECT current_user AS role')).rows[0]?.role
        ).toBe(target.login);

        await client.query('BEGIN TRANSACTION READ ONLY');
        await client.query('SELECT 1');
        let readWriteTransitionErrorCode: string | undefined;
        try {
          await client.query('SET TRANSACTION READ WRITE');
        } catch (error) {
          readWriteTransitionErrorCode = (error as { code?: string }).code;
        }
        await client.query('ROLLBACK');
        expect(readWriteTransitionErrorCode).toBe('25001');

        await client.query('BEGIN TRANSACTION READ ONLY');
        await client.query('SET SESSION default_transaction_read_only = off');
        const activeTransactionState = await client.query<{
          transactionReadOnly: string;
          defaultTransactionReadOnly: string;
        }>(
          `SELECT current_setting('transaction_read_only') AS "transactionReadOnly",
                  current_setting('default_transaction_read_only') AS "defaultTransactionReadOnly"`
        );
        expect(activeTransactionState.rows).toEqual([
          { transactionReadOnly: 'on', defaultTransactionReadOnly: 'off' }
        ]);
        let activeWriteErrorCode: string | undefined;
        try {
          await client.query(
            "UPDATE public.explorer_rows SET safe_value = 'active-write-probe' WHERE id = 1"
          );
        } catch (error) {
          activeWriteErrorCode = (error as { code?: string }).code;
        }
        await client.query('ROLLBACK');
        expect(activeWriteErrorCode).toBe('25006');

        await client.query('SET SESSION default_transaction_read_only = off');
        let directWriteErrorCode: string | undefined;
        try {
          await client.query(
            "UPDATE public.explorer_rows SET safe_value = 'acl-write-probe' WHERE false"
          );
        } catch (error) {
          directWriteErrorCode = (error as { code?: string }).code;
        }
        await client.query('RESET default_transaction_read_only');
        expect(directWriteErrorCode).toBe('42501');
      } finally {
        client.release();
      }

      expect(await integrity(targetId)).toEqual(before);
    }
  });

  it('accepts five filters and rejects a sixth against live PostgreSQL rows', async () => {
    const filters = [
      { column: 'safe_value', operator: 'eq' as const, value: 'safe-ops-1' },
      { column: 'tenant_id', operator: 'eq' as const, value: 'ops' },
      { column: 'student_id', operator: 'eq' as const, value: '1' },
      { column: 'id', operator: 'eq' as const, value: '1' },
      { column: 'nullable_sort', operator: 'is_not_null' as const }
    ];
    const accepted = await rows({ targetId: 'ops', relation: 'explorer_rows', filters });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      const result = responseRows(accepted);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.cells['safe_value']).toEqual({ state: 'value', value: 'safe-ops-1' });
    }

    const rejected = await rows({
      targetId: 'ops',
      relation: 'explorer_rows',
      filters: [...filters, { column: 'tenant_id', operator: 'eq', value: 'ops' }]
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: 'WORKER_COMMAND_INVALID' }
    });
  });

  it('paginates exact live rows with duplicate sort keys and NULL values without gaps', async () => {
    const explorerRowsSnapshot = fixture.snapshots.ops.schemas
      .find((schema) => schema.name === 'public')
      ?.relations.find((relation) => relation.name === 'explorer_rows');
    expect(explorerRowsSnapshot).toMatchObject({ primaryKey: ['id'], paginationKey: ['id'] });
    expect(explorerRowsSnapshot?.constraints).toContainEqual({
      name: 'explorer_rows_student_fk',
      kind: 'foreign_key',
      columns: ['tenant_id', 'student_id'],
      referencedRelation: {
        schema: 'public',
        name: 'explorer_students',
        columns: ['tenant_id', 'student_id']
      },
      deferrable: false,
      initiallyDeferred: false
    });
    const expected = await fixture.adminPools.ops.query<{
      id: number;
      nullable_sort: number | null;
      safe_value: string;
    }>(
      `SELECT id, nullable_sort, safe_value
       FROM public.explorer_rows
       ORDER BY nullable_sort ASC NULLS LAST, id ASC`
    );
    const first = await rows({
      targetId: 'ops',
      relation: 'explorer_rows',
      sort: { column: 'nullable_sort', direction: 'asc' }
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstPage = responseRows(first);
    expect(firstPage.nextCursor).not.toBeNull();

    const second = await rows({
      targetId: 'ops',
      relation: 'explorer_rows',
      sort: { column: 'nullable_sort', direction: 'asc' },
      cursor: firstPage.nextCursor ?? undefined
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondPage = responseRows(second);
    const actual = [...firstPage.rows, ...secondPage.rows].map((row) => ({
      id: row.cells['id']?.state === 'value' ? row.cells['id'].value : null,
      nullable_sort:
        row.cells['nullable_sort']?.state === 'value' ? row.cells['nullable_sort'].value : null,
      safe_value: row.cells['safe_value']?.state === 'value' ? row.cells['safe_value'].value : null
    }));
    expect(actual).toEqual(expected.rows);
    expect(new Set(actual.map((row) => row.id)).size).toBe(32);
    expect(actual.slice(-8).every((row) => row.nullable_sort === null)).toBe(true);
  });

  it('truncates an actual 64 KiB + 1 cell while preserving its original byte count', async () => {
    const response = await rows({ targetId: 'ops', relation: 'cell_bound' });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const result = responseRows(response);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.cells['over_value']).toMatchObject({
      state: 'truncated',
      originalBytes: 65_537
    });
    expect(JSON.stringify(response)).not.toContain('C'.repeat(65_537));
  });

  it('keeps production and ops row data isolated by target', async () => {
    for (const targetId of ['edutrack_production', 'ops'] as const) {
      const response = await rows({ targetId, relation: 'explorer_rows' });
      expect(response.ok).toBe(true);
      if (!response.ok) continue;
      const result = responseRows(response);
      expect(result.targetId).toBe(targetId);
      expect(result.rows[0]?.cells['safe_value']).toEqual({
        state: 'value',
        value: `safe-${targetId}-1`
      });
      expect(JSON.stringify(result.rows)).not.toContain(
        `safe-${targetId === 'ops' ? 'edutrack_production' : 'ops'}-`
      );
    }
  });

  it('fails closed when both target roles are provisioned on the same PostgreSQL cluster', async () => {
    const production = fixture.config.targets.edutrack_production;
    const ops = fixture.config.targets.ops;
    const result = spawnSync(
      'bash',
      [
        'deploy/postgres/apply-role-grants.sh',
        '--role-type',
        'explorer',
        '--target',
        'ops',
        '--database',
        'edutrack_ops',
        '--admin-pgpass-file',
        production.adminPgpassFile,
        '--browser-login',
        ops.login,
        '--browser-password-file',
        ops.browserPasswordFile,
        '--business-schemas',
        'public',
        '--schema-owner-role',
        fixture.config.schemaOwnerRole,
        '--browser-database-url-file',
        ops.browserDatabaseUrlFile,
        '--fixture',
        'public.explorer_rows',
        '--safe-column',
        'safe_value',
        '--blocked-column',
        'blocked_token',
        '--require-tls',
        '--revoke-public-privileges'
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PGHOST: production.host,
          PGPORT: String(production.port),
          PGUSER: 'postgres',
          PGSSLMODE: 'verify-full',
          PGSSLROOTCERT: fixture.config.caFile,
          PGCONNECT_TIMEOUT: '5'
        },
        maxBuffer: 2 * 1024 * 1024
      }
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stderr ?? ''}${result.stdout ?? ''}`).toContain(
      'ops_database_browser already provisioned for the other target'
    );
    expect(`${result.stderr ?? ''}${result.stdout ?? ''}`).not.toContain(fixture.config.hmacSecret);
  });

  it('revokes unsafe default ACLs for new owner-created objects and blocks unapproved creators', async () => {
    const targetId = 'ops';
    const admin = fixture.adminPools[targetId];
    const objectName = 'task7_default_acl_probe';
    const functionName = 'task7_default_acl_probe_fn';
    await admin.query('SET ROLE explorer_fixture_owner');
    try {
      await admin.query(
        `CREATE TABLE public.${objectName} (id serial PRIMARY KEY, safe_value text)`
      );
      await admin.query(
        `CREATE FUNCTION public.${functionName}() RETURNS integer LANGUAGE sql AS 'SELECT 1'`
      );
    } finally {
      await admin.query('RESET ROLE');
    }

    try {
      const acl = await admin.query<{
        browser_select: boolean;
        browser_sequence_usage: boolean;
        browser_function_execute: boolean;
        public_function_execute: boolean;
        unapproved_schema_create: boolean;
      }>(
        `SELECT
           has_table_privilege('ops_database_browser', 'public.${objectName}', 'SELECT') AS browser_select,
           has_sequence_privilege('ops_database_browser', 'public.${objectName}_id_seq', 'USAGE') AS browser_sequence_usage,
           has_function_privilege('ops_database_browser', 'public.${functionName}()', 'EXECUTE') AS browser_function_execute,
           EXISTS (
             SELECT 1 FROM pg_proc function
             CROSS JOIN LATERAL aclexplode(COALESCE(function.proacl, acldefault('f', function.proowner))) privilege
             WHERE function.proname = '${functionName}' AND privilege.grantee = 0
               AND privilege.privilege_type = 'EXECUTE'
           ) AS public_function_execute,
           has_schema_privilege('explorer_unapproved_creator', 'public', 'CREATE') AS unapproved_schema_create`
      );
      expect(acl.rows).toEqual([
        {
          browser_select: false,
          browser_sequence_usage: false,
          browser_function_execute: false,
          public_function_execute: false,
          unapproved_schema_create: false
        }
      ]);

      const browser = await fixture.browserPools[targetId].connect();
      try {
        let newTableReadRejected = false;
        try {
          await browser.query(`SELECT * FROM public.${objectName}`);
        } catch {
          newTableReadRejected = true;
        }
        expect(newTableReadRejected).toBe(true);

        let newFunctionCallRejected = false;
        try {
          await browser.query(`SELECT public.${functionName}()`);
        } catch {
          newFunctionCallRejected = true;
        }
        expect(newFunctionCallRejected).toBe(true);
      } finally {
        browser.release();
      }

      const creator = await admin.connect();
      try {
        await creator.query('SET ROLE explorer_unapproved_creator');
        let createRejected = false;
        try {
          await creator.query('CREATE TABLE public.task7_unapproved_creator_probe (id integer)');
        } catch {
          createRejected = true;
        }
        await creator.query('RESET ROLE');
        expect(createRejected).toBe(true);
      } finally {
        creator.release();
      }
    } finally {
      await admin.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
      await admin.query(`DROP TABLE IF EXISTS public.${objectName}`);
    }
  });

  it('reports schema drift, invalidates the cached snapshot, and recovers after restoration', async () => {
    const targetId = 'ops';
    const before = await integrity(targetId);
    await fixture.adminPools[targetId].query(
      'ALTER TABLE public.explorer_rows ADD COLUMN task7_schema_drift_probe integer'
    );
    try {
      const stale = await rows({ targetId, relation: 'explorer_rows' });
      expect(stale).toMatchObject({
        ok: false,
        error: { code: 'DATABASE_SCHEMA_STALE' }
      });
    } finally {
      await fixture.adminPools[targetId].query(
        'ALTER TABLE public.explorer_rows DROP COLUMN task7_schema_drift_probe'
      );
    }
    const recovered = await rows({ targetId, relation: 'explorer_rows' });
    expect(recovered.ok).toBe(true);
    expect(await integrity(targetId)).toEqual(before);
  });

  it('rolls back a worker query canceled by PostgreSQL statement_timeout', async () => {
    const response = await rows({ targetId: 'ops', relation: 'timeout_probe' });
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'DATABASE_QUERY_TIMEOUT' }
    });
    const sessions = await fixture.adminPools.ops.query<{ openTransactions: number }>(
      `SELECT count(*)::integer AS "openTransactions"
       FROM pg_stat_activity
       WHERE application_name = 'edutrack-ops-database-explorer:ops'
         AND state = 'idle in transaction'`
    );
    expect(sessions.rows[0]?.openTransactions).toBe(0);
  }, 25_000);

  it('marks a stopped isolated target unavailable and healthy again after restart', async () => {
    const target = fixture.config.targets.ops;
    const before = await targets();
    expect(before.find((entry) => entry.id === 'ops')?.status).toBe('available');
    runTargetControl(target, 'stop');
    try {
      await delay(5_100);
      const unavailable = await targets();
      expect(unavailable.find((entry) => entry.id === 'ops')?.status).toBe('unavailable');
      const failedRows = await rows({ targetId: 'ops', relation: 'explorer_rows' });
      expect(failedRows).toMatchObject({
        ok: false,
        error: { code: 'DATABASE_TARGET_UNAVAILABLE' }
      });
    } finally {
      runTargetControl(target, 'start');
    }

    let recovered = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await delay(1_000);
      const summaries = await targets();
      if (summaries.find((entry) => entry.id === 'ops')?.status === 'available') {
        recovered = true;
        break;
      }
    }
    expect(recovered).toBe(true);
    const response = await rows({ targetId: 'ops', relation: 'explorer_rows' });
    expect(response.ok).toBe(true);
  }, 30_000);

  it('rejects an actual 33 x 64 KiB row without returning partial cell bytes', async () => {
    const response = await rows({ targetId: 'ops', relation: 'wide_rows' });
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'DATABASE_RESULT_TOO_LARGE' }
    });
    expect(JSON.stringify(response)).not.toContain('WIDE-ROW-SENTINEL-');
    expect(JSON.stringify(response)).not.toContain('WWWWWWWWWW');

    const stored = await fixture.adminPools.ops.query<{ bytes: number; marker: string }>(
      `SELECT octet_length(wide_00) AS bytes, left(wide_00, 20) AS marker
       FROM public.wide_rows WHERE id = 1`
    );
    expect(stored.rows).toEqual([{ bytes: 65_536, marker: 'WIDE-ROW-SENTINEL-00' }]);
  });
});
