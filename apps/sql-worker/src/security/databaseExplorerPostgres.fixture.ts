import { randomUUID } from 'node:crypto';
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Pool } from 'pg';
import { DATABASE_POLICY_VERSION } from '../../../../packages/security/src/database/columnPolicy.js';
import type { DatabaseExplorerSchemaSnapshot, DatabaseTargetId } from '../../../../packages/contracts/src/databaseExplorer.js';
import type { SqlWorkerActor } from '../../../../packages/contracts/src/workerProtocol.js';
import { renderDatabaseExplorerGrants } from '../../../../deploy/postgres/render-database-explorer-grants.js';
import { createExplorerSchemaReader } from '../explorer/schemaReader.js';
import { readProductionSchema } from '../schema/introspectSchema.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import { SqlWorkerClient } from '../../../api/src/modules/sql/workerClient.js';
import { startOpsSqlWorker } from '../runtime/main.js';

export type PostgresIntegrationTarget = {
  targetId: DatabaseTargetId;
  login: string;
  databaseName: string;
  marker: string;
  host: string;
  port: number;
  browserUrl: string;
  browserDatabaseUrlFile: string;
  browserPasswordFile: string;
  browserPgpassFile: string;
  adminUrl: string;
  adminPgpassFile: string;
  dataDirectory?: string;
  logFile?: string;
  socketDirectory?: string;
  pgCtl?: string;
  caFile?: string;
  serverCertFile?: string;
  serverKeyFile?: string;
  service?: string;
  project?: string;
  composeFile?: string;
  composeCommand?: 'docker-compose' | 'docker compose';
};

export type PostgresIntegrationConfig = {
  runtime: 'native' | 'compose';
  tempRoot: string;
  caFile: string;
  hmacSecret: string;
  cursorKey: string;
  schemaOwnerRole: string;
  creatorRole: string;
  fixtureSchema: string;
  fixtureRelation: string;
  safeColumn: string;
  blockedColumn: string;
  targets: Record<'edutrack_production' | 'ops', PostgresIntegrationTarget>;
};

export const integrationActor: SqlWorkerActor = {
  userId: 'postgres-integration-owner',
  sessionId: 'postgres-integration-session',
  role: 'ops_maintainer'
};

export type PostgresWorkerFixture = {
  config: PostgresIntegrationConfig;
  client: SqlWorkerClient;
  adminPools: Record<'edutrack_production' | 'ops', Pool>;
  browserPools: Record<'edutrack_production' | 'ops', Pool>;
  snapshots: Record<'edutrack_production' | 'ops', DatabaseExplorerSchemaSnapshot>;
  socketPath: string;
  close: () => Promise<void>;
};

function createIntegrationPool(connectionString: string, max: number): Pool {
  const pool = new Pool({ connectionString, max });
  // The outage integration case deliberately kills one PostgreSQL process;
  // discard expected idle-client disconnect events instead of leaking them as
  // uncaught EventEmitter errors from the test process.
  pool.on('error', () => undefined);
  return pool;
}

function isTargetId(value: string): value is DatabaseTargetId {
  return value === 'edutrack_production' || value === 'ops';
}

export async function readPostgresIntegrationConfig(): Promise<PostgresIntegrationConfig> {
  const configPath = process.env.DATABASE_EXPLORER_TEST_CONFIG;
  if (!configPath) throw new Error('DATABASE_EXPLORER_TEST_CONFIG is required; run the PostgreSQL integration gate');
  const details = await stat(configPath);
  if (!details.isFile() || (details.mode & 0o777) !== 0o600) {
    throw new Error('PostgreSQL integration config must be a regular mode-0600 file');
  }
  const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PostgreSQL integration config is malformed');
  }
  const config = parsed as PostgresIntegrationConfig;
  if (
    (config.runtime !== 'native' && config.runtime !== 'compose') ||
    !config.tempRoot ||
    !config.caFile ||
    !config.hmacSecret ||
    !config.cursorKey ||
    !config.targets?.edutrack_production ||
    !config.targets?.ops
  ) {
    throw new Error('PostgreSQL integration config is incomplete');
  }
  for (const targetId of ['edutrack_production', 'ops'] as const) {
    const target = config.targets[targetId];
    const url = new URL(target.browserUrl);
    if (
      target.targetId !== targetId ||
      !isTargetId(target.targetId) ||
      target.databaseName !== (targetId === 'ops' ? 'edutrack_ops' : 'edutrack_production') ||
      url.searchParams.get('sslmode') !== 'verify-full' ||
      url.searchParams.get('sslrootcert') !== config.caFile ||
      !target.browserDatabaseUrlFile ||
      !target.browserPasswordFile ||
      !target.browserPgpassFile ||
      !target.adminPgpassFile
    ) {
      throw new Error(`PostgreSQL integration target config is invalid: ${targetId}`);
    }
    for (const path of [
      target.browserDatabaseUrlFile,
      target.browserPasswordFile,
      target.browserPgpassFile,
      target.adminPgpassFile
    ]) {
      const file = await stat(path);
      if (!file.isFile() || (file.mode & 0o777) !== 0o600) {
        throw new Error(`PostgreSQL integration secret must be a regular mode-0600 file: ${path}`);
      }
    }
  }
  return config;
}

function runRoleProvisioning(
  config: PostgresIntegrationConfig,
  target: PostgresIntegrationTarget,
  grantsFile: string
): void {
  const args = [
    'deploy/postgres/apply-role-grants.sh',
    '--role-type',
    'explorer',
    '--target',
    target.targetId,
    '--database',
    target.databaseName,
    '--admin-pgpass-file',
    target.adminPgpassFile,
    '--browser-login',
    target.login,
    '--browser-password-file',
    target.browserPasswordFile,
    '--business-schemas',
    'public',
    '--schema-owner-role',
    config.schemaOwnerRole,
    '--browser-database-url-file',
    target.browserDatabaseUrlFile,
    '--fixture',
    `${config.fixtureSchema}.${config.fixtureRelation}`,
    '--safe-column',
    config.safeColumn,
    '--blocked-column',
    config.blockedColumn,
    '--grants-file',
    grantsFile,
    '--require-tls',
    '--revoke-public-privileges'
  ];
  const result = spawnSync('bash', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: target.host,
      PGPORT: String(target.port),
      PGUSER: 'postgres',
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: config.caFile,
      PGCONNECT_TIMEOUT: '5'
    },
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()]
      .filter(Boolean)
      .join('\n');
    throw new Error(`Task 6 PostgreSQL provisioning failed for ${target.targetId}: ${detail}`);
  }
}

export async function startPostgresWorkerFixture(): Promise<PostgresWorkerFixture> {
  const config = await readPostgresIntegrationConfig();
  const adminPools: Record<'edutrack_production' | 'ops', Pool> = {
    edutrack_production: createIntegrationPool(config.targets.edutrack_production.adminUrl, 2),
    ops: createIntegrationPool(config.targets.ops.adminUrl, 2)
  };
  const browserPools: Record<'edutrack_production' | 'ops', Pool> = {
    edutrack_production: createIntegrationPool(config.targets.edutrack_production.browserUrl, 2),
    ops: createIntegrationPool(config.targets.ops.browserUrl, 2)
  };
  const snapshots = {} as Record<'edutrack_production' | 'ops', DatabaseExplorerSchemaSnapshot>;
  const checksums: Partial<Record<DatabaseTargetId, string>> = {};
  const workerSocket = join(config.tempRoot, `worker-${process.pid}-${randomUUID()}.sock`);
  let worker: Awaited<ReturnType<typeof startOpsSqlWorker>> | undefined;

  try {
    for (const targetId of ['edutrack_production', 'ops'] as const) {
      const target = config.targets[targetId];
      const pool = adminPools[targetId];
      const structuralConnection = await pool.connect();
      let structural;
      try {
        structural = await readProductionSchema({ database: structuralConnection });
      } finally {
        structuralConnection.release();
      }
      checksums[targetId] = structural.checksum;

      const availableTarget: AvailableTargetEntry = {
        id: targetId,
        label: targetId === 'ops' ? 'Task 7 Ops fixture' : 'Task 7 Production fixture',
        status: 'available',
        pool: pool as unknown as AvailableTargetEntry['pool'],
        databaseName: target.databaseName,
        role: target.login
      };
      const approval = {
        version: DATABASE_POLICY_VERSION,
        targets: { [targetId]: structural.checksum }
      };
      const readSnapshot = createExplorerSchemaReader({
        target: availableTarget,
        getPolicyApproval: () => approval
      });
      const snapshot = await readSnapshot();
      snapshots[targetId] = snapshot;
      const grantSql = renderDatabaseExplorerGrants({ snapshot });
      const grantsFile = join(config.tempRoot, `grants-${targetId}-${randomUUID()}.sql`);
      await writeFile(grantsFile, grantSql, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await chmod(grantsFile, 0o600);
      runRoleProvisioning(config, target, grantsFile);
    }

    const policyApproval = JSON.stringify({
      version: DATABASE_POLICY_VERSION,
      targets: checksums
    });
    const secretValues: Record<string, string> = {
      'integration-worker-hmac': config.hmacSecret,
      'integration-cursor-key': config.cursorKey,
      'integration-policy-approval': policyApproval,
      'integration-edutrack-database-url': config.targets.edutrack_production.browserUrl,
      'integration-ops-database-url': config.targets.ops.browserUrl
    };
    const environment: NodeJS.ProcessEnv = {
      OPS_SECRET_DIRECTORY: join(config.tempRoot, 'secrets'),
      OPS_SQL_SOCKET_PATH: workerSocket,
      OPS_SQL_WORKER_HMAC_REFERENCE: 'integration-worker-hmac',
      OPS_SQL_READ_ENABLED: 'false',
      OPS_SQL_MUTATION_ENABLED: 'false',
      OPS_DATABASE_EXPLORER_ENABLED: 'true',
      OPS_DATABASE_CURSOR_KEY_REFERENCE: 'integration-cursor-key',
      OPS_DATABASE_POLICY_APPROVAL_REFERENCE: 'integration-policy-approval',
      OPS_DATABASE_EDUTRACK_ENABLED: 'true',
      OPS_DATABASE_EDUTRACK_URL_REFERENCE: 'integration-edutrack-database-url',
      OPS_DATABASE_EDUTRACK_NAME: 'edutrack_production',
      OPS_DATABASE_EDUTRACK_ROLE: 'ops_browser_edutrack',
      OPS_DATABASE_OPS_ENABLED: 'true',
      OPS_DATABASE_OPS_URL_REFERENCE: 'integration-ops-database-url',
      OPS_DATABASE_OPS_NAME: 'edutrack_ops',
      OPS_DATABASE_OPS_ROLE: 'ops_browser_ops',
      OPS_TELEMETRY_ENABLED: 'false'
    };
    worker = await startOpsSqlWorker({
      environment,
      resolveSecret: async (reference) => secretValues[reference] ?? null
    });
    const client = new SqlWorkerClient({ socketPath: workerSocket, secret: config.hmacSecret });

    return {
      config,
      client,
      adminPools,
      browserPools,
      snapshots,
      socketPath: workerSocket,
      close: async () => {
        await worker?.close();
        await Promise.all([
          ...Object.values(browserPools).map((pool) => pool.end()),
          ...Object.values(adminPools).map((pool) => pool.end())
        ]);
      }
    };
  } catch (error) {
    await worker?.close().catch(() => undefined);
    await Promise.all([
      ...Object.values(browserPools).map((pool) => pool.end().catch(() => undefined)),
      ...Object.values(adminPools).map((pool) => pool.end().catch(() => undefined))
    ]);
    throw error;
  }
}

export function runTargetControl(
  target: PostgresIntegrationTarget,
  action: 'stop' | 'start'
): void {
  if (target.pgCtl && target.dataDirectory && target.logFile && target.socketDirectory) {
    if (!target.caFile || !target.serverCertFile || !target.serverKeyFile) {
      throw new Error(`TLS certificate paths are not configured for ${target.targetId}`);
    }
    const result =
      action === 'stop'
        ? spawnSync(target.pgCtl, ['-D', target.dataDirectory, '-m', 'fast', '-w', 'stop'], {
            encoding: 'utf8'
          })
        : spawnSync(
            target.pgCtl,
            [
              '-D',
              target.dataDirectory,
              '-l',
              target.logFile,
              '-o',
              `-p ${target.port} -h 127.0.0.1 -c unix_socket_directories=${target.socketDirectory} -c ssl=on -c ssl_ca_file=${target.caFile} -c ssl_cert_file=${target.serverCertFile} -c ssl_key_file=${target.serverKeyFile} -c log_statement=none -c log_min_error_statement=panic -c log_connections=off -c log_disconnections=off`,
              '-w',
              'start'
            ],
            { encoding: 'utf8' }
          );
    if (result.error || result.status !== 0) {
      throw new Error(`Unable to ${action} isolated PostgreSQL fixture ${target.targetId}: ${result.stderr?.trim() ?? result.error?.message ?? 'pg_ctl failed'}`);
    }
    return;
  }
  if (target.service && target.project && target.composeFile) {
    const compose = target.composeCommand === 'docker-compose'
      ? ['docker-compose']
      : ['docker', 'compose'];
    const result = spawnSync(
      compose[0]!,
      [...compose.slice(1), '-p', target.project, '-f', target.composeFile, action === 'stop' ? 'stop' : 'start', target.service],
      { encoding: 'utf8' }
    );
    if (result.error || result.status !== 0) {
      throw new Error(`Unable to ${action} isolated PostgreSQL fixture ${target.targetId}: ${result.stderr?.trim() ?? result.error?.message ?? 'docker compose failed'}`);
    }
    return;
  }
  throw new Error(`No isolated PostgreSQL ${action} control is configured for ${target.targetId}`);
}
