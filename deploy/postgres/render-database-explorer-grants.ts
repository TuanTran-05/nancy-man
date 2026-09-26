import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseTargetId
} from '../../packages/contracts/src/databaseExplorer.js';

const policyModule =
  // @ts-expect-error -- This CLI runs directly via Node's strip-types mode, which requires
  // an explicit .ts specifier. Spawned CLI tests protect the runtime resolution path.
  await import('../../packages/security/src/database/columnPolicy.ts');
const { classifyColumn, DATABASE_POLICY_VERSION } = policyModule;

const ROLE_NAME = 'ops_database_browser';
const TARGET_IDS = new Set(['edutrack_production', 'ops']);
const FORBIDDEN_SCHEMA_NAMES = new Set(['_ops', 'information_schema', 'pg_catalog']);
const RELATION_KINDS = new Set([
  'table',
  'partitioned_table',
  'view',
  'materialized_view',
  'foreign_table'
]);
const CLASSIFICATIONS = new Set(['public', 'internal', 'pii', 'blocked']);

export type RenderGrantsInput = {
  snapshot: DatabaseExplorerSchemaSnapshot;
  roleName?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTargetId(value: unknown): value is DatabaseTargetId {
  return typeof value === 'string' && TARGET_IDS.has(value);
}

function containsRowData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRowData);
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (['rows', 'cells', 'rowref', 'rowrefs'].includes(key.toLowerCase())) return true;
    if (containsRowData(nested)) return true;
  }
  return false;
}

function quoteIdentifier(value: string): string {
  if (!value || value.includes('\0')) throw new Error('SNAPSHOT_IDENTIFIER_INVALID');
  return `"${value.replaceAll('"', '""')}"`;
}

function canonicalStructuralChecksum(snapshot: DatabaseExplorerSchemaSnapshot): string {
  const structural = {
    schemas: snapshot.schemas.map((schema) => ({
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
    }))
  };
  return createHash('sha256').update(JSON.stringify(structural), 'utf8').digest('hex');
}

function policyClassification(
  targetId: DatabaseTargetId,
  schema: string,
  relation: string,
  column: string
): string {
  return classifyColumn({ targetId, schema, relation, column });
}

function validateSnapshot(value: unknown): DatabaseExplorerSchemaSnapshot {
  if (!isRecord(value) || containsRowData(value)) {
    throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
  }
  if (!isTargetId(value.targetId)) throw new Error('TARGET_INVALID');
  if (
    typeof value.targetLabel !== 'string' ||
    typeof value.checksum !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.checksum) ||
    value.policyVersion !== DATABASE_POLICY_VERSION ||
    !Array.isArray(value.schemas) ||
    !Array.isArray(value.edges)
  ) {
    throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
  }

  for (const schema of value.schemas) {
    if (!isRecord(schema) || typeof schema.name !== 'string' || !Array.isArray(schema.relations)) {
      throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
    }
    if (
      FORBIDDEN_SCHEMA_NAMES.has(schema.name.toLowerCase()) ||
      schema.name.toLowerCase().startsWith('pg_')
    ) {
      throw new Error('PROTECTED_SCHEMA_INVALID');
    }
    for (const relation of schema.relations) {
      if (
        !isRecord(relation) ||
        typeof relation.name !== 'string' ||
        !RELATION_KINDS.has(String(relation.kind)) ||
        typeof relation.dataAvailable !== 'boolean' ||
        !Array.isArray(relation.columns)
      ) {
        throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
      }
      for (const column of relation.columns) {
        if (
          !isRecord(column) ||
          typeof column.name !== 'string' ||
          typeof column.selectable !== 'boolean' ||
          !CLASSIFICATIONS.has(String(column.classification))
        ) {
          throw new Error('STRUCTURAL_SNAPSHOT_INVALID');
        }
        const classification = policyClassification(
          value.targetId,
          schema.name,
          relation.name,
          column.name
        );
        if (
          column.classification !== classification ||
          column.selectable !== (classification !== 'blocked')
        ) {
          throw new Error('POLICY_FIELDS_MISMATCH');
        }
      }
    }
  }

  const snapshot = value as unknown as DatabaseExplorerSchemaSnapshot;
  if (canonicalStructuralChecksum(snapshot) !== snapshot.checksum) {
    throw new Error('STRUCTURAL_CHECKSUM_MISMATCH');
  }
  return snapshot;
}

export function renderDatabaseExplorerGrants(input: RenderGrantsInput): string {
  const snapshot = validateSnapshot(input.snapshot);
  const roleName = input.roleName ?? ROLE_NAME;
  if (roleName !== ROLE_NAME) throw new Error('ROLE_INVALID');
  const roleQuoted = quoteIdentifier(roleName);
  const statements: string[] = [];

  statements.push(`-- Database Explorer grants for role ${roleQuoted}`);
  statements.push(`-- Target: ${snapshot.targetId} (Checksum: ${snapshot.checksum})`);
  statements.push('BEGIN;');

  for (const schema of snapshot.schemas) {
    const schemaQuoted = quoteIdentifier(schema.name);
    statements.push(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schemaQuoted} FROM ${roleQuoted};`
    );
  }

  for (const schema of snapshot.schemas) {
    const schemaQuoted = quoteIdentifier(schema.name);
    statements.push(`GRANT USAGE ON SCHEMA ${schemaQuoted} TO ${roleQuoted};`);

    for (const relation of schema.relations) {
      if (!relation.dataAvailable || relation.kind === 'foreign_table') continue;

      const safeColumns = relation.columns.filter(
        (column) =>
          policyClassification(snapshot.targetId, schema.name, relation.name, column.name) !==
          'blocked'
      );
      if (safeColumns.length === 0) continue;

      const relationQuoted = quoteIdentifier(relation.name);
      const columnsQuoted = safeColumns.map((column) => quoteIdentifier(column.name)).join(', ');
      statements.push(
        `GRANT SELECT (${columnsQuoted}) ON ${schemaQuoted}.${relationQuoted} TO ${roleQuoted};`
      );
    }
  }

  statements.push('COMMIT;');
  statements.push('');
  return statements.join('\n');
}

type CliOptions = {
  snapshotFile: string;
  approvalFile: string;
  target: DatabaseTargetId;
  role: string;
  output: string;
};

function parseArguments(argumentsList: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const allowed = new Set(['--snapshot-file', '--approval-file', '--target', '--role', '--output']);
  for (let index = 0; index < argumentsList.length; index++) {
    const flag = argumentsList[index];
    if (!flag || !allowed.has(flag) || values.has(flag)) throw new Error('ARGUMENTS_INVALID');
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) throw new Error('ARGUMENTS_INVALID');
    values.set(flag, value);
    index++;
  }

  const snapshotFile = values.get('--snapshot-file');
  const approvalFile = values.get('--approval-file');
  const target = values.get('--target');
  const role = values.get('--role');
  const output = values.get('--output');
  if (!snapshotFile || !approvalFile || !target || !role || !output) {
    throw new Error('ARGUMENTS_REQUIRED');
  }
  if (!isTargetId(target)) throw new Error('TARGET_INVALID');
  if (role !== ROLE_NAME) throw new Error('ROLE_INVALID');
  if (resolve(output) === resolve(snapshotFile) || resolve(output) === resolve(approvalFile)) {
    throw new Error('OUTPUT_PATH_INVALID');
  }

  return { snapshotFile, approvalFile, target, role, output };
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('INPUT_FILE_INVALID');
  }
}

function validateApproval(value: unknown, target: DatabaseTargetId, checksum: string): void {
  if (!isRecord(value) || value.version !== DATABASE_POLICY_VERSION || !isRecord(value.targets)) {
    throw new Error('APPROVAL_INVALID');
  }
  if (value.targets[target] !== checksum) throw new Error('CHECKSUM_NOT_APPROVED');
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const snapshot = validateSnapshot(await readJsonFile(options.snapshotFile));
  if (snapshot.targetId !== options.target) throw new Error('TARGET_MISMATCH');
  const approval = await readJsonFile(options.approvalFile);
  validateApproval(approval, options.target, snapshot.checksum);
  const sql = renderDatabaseExplorerGrants({ snapshot, roleName: options.role });

  try {
    await writeFile(options.output, sql, { encoding: 'utf8', flag: 'wx' });
  } catch {
    throw new Error('OUTPUT_WRITE_FAILED');
  }
  process.stdout.write(
    `DATABASE_EXPLORER_GRANTS_WRITTEN target=${options.target} checksum=${snapshot.checksum}\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const code = error instanceof Error ? error.message : 'RENDER_FAILED';
    process.stderr.write(`render-database-explorer-grants: ${code}\n`);
    process.exitCode = 2;
  });
}
