import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDatabaseExplorerGrants } from './render-database-explorer-grants.js';
import type { DatabaseExplorerSchemaSnapshot } from '../../packages/contracts/src/databaseExplorer.js';
import { DATABASE_POLICY_VERSION } from '../../packages/security/src/database/columnPolicy.js';

const rendererPath = resolve(process.cwd(), 'deploy/postgres/render-database-explorer-grants.ts');

function runRenderer(args: string[]) {
  return spawnSync(process.execPath, ['--experimental-strip-types', rendererPath, ...args], {
    encoding: 'utf8'
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function structuralChecksum(snapshot: DatabaseExplorerSchemaSnapshot): string {
  const schemas = snapshot.schemas.map((schema) => ({
    name: schema.name,
    relations: schema.relations.map((relation) => ({
      name: relation.name,
      kind: relation.kind,
      rowLevelSecurity: relation.rowLevelSecurity,
      columns: relation.columns.map((column) => ({
        name: column.name,
        dataType: column.dataType,
        nullable: column.nullable,
        hasDefault: column.hasDefault,
        identity: column.identity,
        generated: column.generated
      })),
      constraints: relation.constraints,
      indexes: relation.indexes,
      triggers: relation.triggers,
      policies: relation.policies
    }))
  }));
  return createHash('sha256').update(JSON.stringify({ schemas }), 'utf8').digest('hex');
}

describe('renderDatabaseExplorerGrants', () => {
  const snapshot: DatabaseExplorerSchemaSnapshot = {
    targetId: 'edutrack_production',
    targetLabel: 'EduTrack Production',
    checksum: 'a'.repeat(64),
    policyVersion: DATABASE_POLICY_VERSION,
    edges: [],
    schemas: [
      {
        name: 'public',
        relations: [
          {
            name: 'students',
            kind: 'table',
            rowLevelSecurity: { enabled: false, forced: false },
            dataAvailable: true,
            estimatedRows: 100,
            primaryKey: ['id'],
            paginationKey: ['id'],
            constraints: [],
            indexes: [],
            triggers: [],
            policies: [],
            columns: [
              {
                name: 'id',
                dataType: 'uuid',
                nullable: false,
                hasDefault: true,
                identity: null,
                generated: false,
                classification: 'internal',
                selectable: true,
                filterOperators: ['eq']
              },
              {
                name: 'email',
                dataType: 'text',
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'pii',
                selectable: true,
                filterOperators: ['eq']
              },
              {
                name: 'password_hash',
                dataType: 'text',
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'blocked',
                selectable: false,
                filterOperators: []
              }
            ]
          },
          {
            name: 'foreign_archive',
            kind: 'foreign_table',
            rowLevelSecurity: { enabled: false, forced: false },
            dataAvailable: false,
            estimatedRows: null,
            primaryKey: null,
            paginationKey: null,
            constraints: [],
            indexes: [],
            triggers: [],
            policies: [],
            columns: [
              {
                name: 'payload',
                dataType: 'text',
                nullable: true,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'internal',
                selectable: true,
                filterOperators: ['eq']
              }
            ]
          }
        ]
      }
    ]
  };

  snapshot.checksum = structuralChecksum(snapshot);

  it('renders column-level SELECT grants only for safe columns and excludes blocked columns', () => {
    const sql = renderDatabaseExplorerGrants({ snapshot });

    expect(sql).toContain('GRANT USAGE ON SCHEMA "public" TO "ops_database_browser";');
    expect(sql).toContain(
      'GRANT SELECT ("id", "email") ON "public"."students" TO "ops_database_browser";'
    );
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('foreign_archive');
  });

  it('never emits INSERT, UPDATE, DELETE, or table-level SELECT on all columns', () => {
    const sql = renderDatabaseExplorerGrants({ snapshot });

    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER/i);
    expect(sql).not.toMatch(/GRANT SELECT ON "public"\."students"/i);
  });

  it('safely escapes identifiers with embedded double quotes', () => {
    const oddSnapshot: DatabaseExplorerSchemaSnapshot = {
      targetId: 'ops',
      targetLabel: 'Ops',
      checksum: 'b'.repeat(64),
      policyVersion: DATABASE_POLICY_VERSION,
      edges: [],
      schemas: [
        {
          name: 'Odd"Schema',
          relations: [
            {
              name: 'weird"table',
              kind: 'table',
              rowLevelSecurity: { enabled: false, forced: false },
              dataAvailable: true,
              estimatedRows: 1,
              primaryKey: null,
              paginationKey: null,
              constraints: [],
              indexes: [],
              triggers: [],
              policies: [],
              columns: [
                {
                  name: 'odd"col',
                  dataType: 'text',
                  nullable: true,
                  hasDefault: false,
                  identity: null,
                  generated: false,
                  classification: 'internal',
                  selectable: true,
                  filterOperators: ['eq']
                }
              ]
            }
          ]
        }
      ]
    };

    oddSnapshot.checksum = structuralChecksum(oddSnapshot);

    const sql = renderDatabaseExplorerGrants({ snapshot: oddSnapshot });
    expect(sql).toContain('GRANT USAGE ON SCHEMA "Odd""Schema" TO "ops_database_browser";');
    expect(sql).toContain(
      'GRANT SELECT ("odd""col") ON "Odd""Schema"."weird""table" TO "ops_database_browser";'
    );
  });

  it('runs as a strict CLI and writes grants only for an approved target checksum', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-grants-'));
    try {
      const snapshotPath = join(directory, 'schema.json');
      const approvalPath = join(directory, 'approval.json');
      const outputPath = join(directory, 'grants.sql');
      await writeJson(snapshotPath, snapshot);
      await writeJson(approvalPath, {
        version: DATABASE_POLICY_VERSION,
        targets: { edutrack_production: snapshot.checksum }
      });

      const run = runRenderer([
        '--snapshot-file',
        snapshotPath,
        '--approval-file',
        approvalPath,
        '--target',
        'edutrack_production',
        '--role',
        'ops_database_browser',
        '--output',
        outputPath
      ]);

      expect(run.status, run.stderr).toBe(0);
      const sql = await readFile(outputPath, 'utf8');
      const revokeIndex = sql.indexOf(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM "ops_database_browser";'
      );
      const grantIndex = sql.indexOf(
        'GRANT SELECT ("id", "email") ON "public"."students" TO "ops_database_browser";'
      );
      expect(revokeIndex).toBeGreaterThanOrEqual(0);
      expect(grantIndex).toBeGreaterThan(revokeIndex);
      expect(sql).not.toContain('password_hash');
      expect(sql).not.toMatch(/GRANT\s+[^;]*\b(?:SEQUENCE|FUNCTION)\b/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('revokes previous table grants before granting only columns present in the approved snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-grants-'));
    try {
      const staleSnapshot = structuredClone(snapshot);
      staleSnapshot.schemas[0]!.relations[0]!.columns =
        staleSnapshot.schemas[0]!.relations[0]!.columns.filter((column) => column.name !== 'email');
      staleSnapshot.checksum = structuralChecksum(staleSnapshot);
      const snapshotPath = join(directory, 'schema.json');
      const approvalPath = join(directory, 'approval.json');
      const outputPath = join(directory, 'grants.sql');
      await writeJson(snapshotPath, staleSnapshot);
      await writeJson(approvalPath, {
        version: DATABASE_POLICY_VERSION,
        targets: { edutrack_production: staleSnapshot.checksum }
      });

      const run = runRenderer([
        '--snapshot-file',
        snapshotPath,
        '--approval-file',
        approvalPath,
        '--target',
        'edutrack_production',
        '--role',
        'ops_database_browser',
        '--output',
        outputPath
      ]);

      expect(run.status, run.stderr).toBe(0);
      const sql = await readFile(outputPath, 'utf8');
      expect(sql).toContain(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM "ops_database_browser";'
      );
      expect(sql).toContain(
        'GRANT SELECT ("id") ON "public"."students" TO "ops_database_browser";'
      );
      expect(sql).not.toContain('"email"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects missing arguments and invalid targets without writing grant SQL', async () => {
    const missingArguments = runRenderer([]);
    expect(missingArguments.status).not.toBe(0);
    expect(missingArguments.stdout).toBe('');

    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-grants-'));
    try {
      const snapshotPath = join(directory, 'schema.json');
      const approvalPath = join(directory, 'approval.json');
      const outputPath = join(directory, 'grants.sql');
      await writeJson(snapshotPath, snapshot);
      await writeJson(approvalPath, {
        version: DATABASE_POLICY_VERSION,
        targets: { edutrack_production: snapshot.checksum }
      });

      const invalidTarget = runRenderer([
        '--snapshot-file',
        snapshotPath,
        '--approval-file',
        approvalPath,
        '--target',
        'arbitrary_database',
        '--role',
        'ops_database_browser',
        '--output',
        outputPath
      ]);

      expect(invalidTarget.status).not.toBe(0);
      expect(invalidTarget.stdout).toBe('');
      await expect(access(outputPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects row payloads and checksum mismatches without echoing sample values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-grants-'));
    try {
      const dirtySnapshot = {
        ...snapshot,
        schemas: snapshot.schemas.map((schema, schemaIndex) => ({
          ...schema,
          relations: schema.relations.map((relation, relationIndex) =>
            schemaIndex === 0 && relationIndex === 0
              ? { ...relation, rows: [{ email: 'SAMPLE_ROW_SECRET_DO_NOT_PRINT' }] }
              : relation
          )
        }))
      };
      const snapshotPath = join(directory, 'schema.json');
      const approvalPath = join(directory, 'approval.json');
      const outputPath = join(directory, 'grants.sql');
      await writeJson(snapshotPath, dirtySnapshot);
      await writeJson(approvalPath, {
        version: DATABASE_POLICY_VERSION,
        targets: { edutrack_production: snapshot.checksum }
      });

      const dirtySnapshotRun = runRenderer([
        '--snapshot-file',
        snapshotPath,
        '--approval-file',
        approvalPath,
        '--target',
        'edutrack_production',
        '--role',
        'ops_database_browser',
        '--output',
        outputPath
      ]);
      expect(dirtySnapshotRun.status).not.toBe(0);
      expect(dirtySnapshotRun.stdout + dirtySnapshotRun.stderr).not.toContain(
        'SAMPLE_ROW_SECRET_DO_NOT_PRINT'
      );
      await expect(access(outputPath)).rejects.toThrow();

      await writeJson(snapshotPath, snapshot);
      await writeJson(approvalPath, {
        version: DATABASE_POLICY_VERSION,
        targets: { edutrack_production: 'd'.repeat(64) }
      });
      const checksumMismatchRun = runRenderer([
        '--snapshot-file',
        snapshotPath,
        '--approval-file',
        approvalPath,
        '--target',
        'edutrack_production',
        '--role',
        'ops_database_browser',
        '--output',
        outputPath
      ]);
      expect(checksumMismatchRun.status).not.toBe(0);
      expect(checksumMismatchRun.stdout).toBe('');
      await expect(access(outputPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects policy-field tampering even when the approved structural checksum is unchanged', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-grants-'));
    try {
      const tamperedSnapshot = structuredClone(snapshot);
      const blocked = tamperedSnapshot.schemas[0]!.relations[0]!.columns.find(
        (column) => column.name === 'password_hash'
      )!;
      blocked.classification = 'pii';
      blocked.selectable = true;

      const snapshotPath = join(directory, 'schema.json');
      const approvalPath = join(directory, 'approval.json');
      const outputPath = join(directory, 'grants.sql');
      await writeJson(snapshotPath, tamperedSnapshot);
      await writeJson(approvalPath, {
        version: DATABASE_POLICY_VERSION,
        targets: { edutrack_production: snapshot.checksum }
      });

      const run = runRenderer([
        '--snapshot-file',
        snapshotPath,
        '--approval-file',
        approvalPath,
        '--target',
        'edutrack_production',
        '--role',
        'ops_database_browser',
        '--output',
        outputPath
      ]);

      expect(run.status).not.toBe(0);
      expect(run.stdout).toBe('');
      await expect(access(outputPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recomputes the canonical structural checksum before writing grant SQL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'database-explorer-grants-'));
    try {
      const changedSnapshot = structuredClone(snapshot);
      changedSnapshot.schemas[0]!.relations[0]!.columns[0]!.dataType = 'text';
      const snapshotPath = join(directory, 'schema.json');
      const approvalPath = join(directory, 'approval.json');
      const outputPath = join(directory, 'grants.sql');
      await writeJson(snapshotPath, changedSnapshot);
      await writeJson(approvalPath, {
        version: DATABASE_POLICY_VERSION,
        targets: { edutrack_production: snapshot.checksum }
      });

      const run = runRenderer([
        '--snapshot-file',
        snapshotPath,
        '--approval-file',
        approvalPath,
        '--target',
        'edutrack_production',
        '--role',
        'ops_database_browser',
        '--output',
        outputPath
      ]);

      expect(run.status).not.toBe(0);
      expect(run.stdout).toBe('');
      await expect(access(outputPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
