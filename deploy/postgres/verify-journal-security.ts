import { Client } from 'pg';

const databaseUrl = process.env.OPS_JOURNAL_VERIFY_DATABASE_URL;
const expectedDatabase = process.env.OPS_JOURNAL_VERIFY_EXPECTED_DATABASE;
const confirmation = process.env.OPS_JOURNAL_VERIFY_CONFIRM;

if (!databaseUrl || !expectedDatabase || confirmation !== 'I_UNDERSTAND_ROLLBACK_PROBES') {
  throw new Error(
    'Set OPS_JOURNAL_VERIFY_DATABASE_URL, OPS_JOURNAL_VERIFY_EXPECTED_DATABASE, and OPS_JOURNAL_VERIFY_CONFIRM=I_UNDERSTAND_ROLLBACK_PROBES.'
  );
}

type Probe = {
  name: string;
  sql: string;
};

const probes: readonly Probe[] = [
  {
    name: 'disable journal trigger',
    sql: 'ALTER TABLE public.students DISABLE TRIGGER ops_capture_row_change'
  },
  {
    name: 'write journal rows directly',
    sql: 'UPDATE _ops.row_change_journal SET operation = operation WHERE false'
  },
  {
    name: 'bypass trigger execution',
    sql: 'SET LOCAL session_replication_role = replica'
  },
  {
    name: 'replace journal trigger function',
    sql: 'CREATE OR REPLACE FUNCTION _ops.capture_row_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$'
  },
  {
    name: 'take ownership of a business table',
    sql: 'ALTER TABLE public.students OWNER TO ops_dml'
  }
];

async function assertRejected(
  client: Client,
  role: 'ops_dml' | 'ops_ddl',
  probe: Probe
): Promise<void> {
  await client.query('BEGIN');
  await client.query(`SET LOCAL ROLE ${role}`).catch(async (error: unknown) => {
    await client.query('ROLLBACK');
    throw new Error(`Unable to assume ${role} before probe ${probe.name}`, { cause: error });
  });

  let rejected = false;
  try {
    await client.query(probe.sql);
  } catch {
    rejected = true;
  } finally {
    await client.query('ROLLBACK');
  }

  if (!rejected) {
    throw new Error(`${role} unexpectedly completed forbidden probe: ${probe.name}`);
  }
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'edutrack-ops-journal-security-verify'
  });
  await client.connect();

  try {
    const identity = await client.query<{ database_name: string }>(
      'SELECT current_database() AS database_name'
    );
    if (identity.rows[0]?.database_name !== expectedDatabase) {
      throw new Error(
        `Refusing to probe ${identity.rows[0]?.database_name ?? 'unknown'}; expected ${expectedDatabase}.`
      );
    }

    for (const role of ['ops_dml', 'ops_ddl'] as const) {
      for (const probe of probes) {
        await assertRejected(client, role, probe);
      }
    }

    process.stdout.write('Journal security probes were rejected for ops_dml and ops_ddl.\n');
  } finally {
    await client.end();
  }
}

await main();
