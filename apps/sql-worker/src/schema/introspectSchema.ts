import { createHash } from 'node:crypto';

import type {
  DatabaseColumn,
  DatabaseConstraint,
  DatabasePolicy,
  DatabaseRelation,
  DatabaseSchema,
  DatabaseSchemaSnapshot,
  DatabaseTrigger
} from '../../../../packages/contracts/src/databaseSchema.js';

export type CatalogQueryDatabase = {
  query: <T>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

export type CatalogReadConnection = CatalogQueryDatabase & { release: () => void };

type CatalogPool = { connect: () => Promise<CatalogReadConnection> };

type RelationRow = {
  schemaName: string;
  relationName: string;
  kind: DatabaseRelation['kind'];
  rowSecurityEnabled: boolean;
  forceRowSecurity: boolean;
};
type ColumnRow = {
  schemaName: string;
  relationName: string;
  columnName: string;
  dataType: string;
  nullable: boolean;
  hasDefault: boolean;
  identity: string;
  generated: string;
};
type ConstraintRow = {
  schemaName: string;
  relationName: string;
  constraintName: string;
  kind: DatabaseConstraint['kind'];
  columns: string[] | null;
  referencedSchema: string | null;
  referencedRelation: string | null;
  referencedColumns: string[] | null;
  deferrable: boolean;
  initiallyDeferred: boolean;
};
type IndexRow = {
  schemaName: string;
  relationName: string;
  indexName: string;
  method: string;
  columns: string[] | null;
  unique: boolean;
  primary: boolean;
  valid: boolean;
  hasExpressions: boolean;
  isPartial: boolean;
};
type TriggerRow = {
  schemaName: string;
  relationName: string;
  triggerName: string;
  timing: DatabaseTrigger['timing'];
  events: DatabaseTrigger['events'];
  enabled: DatabaseTrigger['enabled'];
};
type PolicyRow = {
  schemaName: string;
  relationName: string;
  policyName: string;
  command: DatabasePolicy['command'];
  permissive: boolean;
  roles: string[] | null;
};

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relationKey(schema: string, relation: string): string {
  return `${schema}\u0000${relation}`;
}

function sortedStrings(values: string[] | null): string[] {
  return [...new Set(values ?? [])].sort(compare);
}

function identity(value: string): DatabaseColumn['identity'] {
  if (value === 'a') return 'always';
  if (value === 'd') return 'by_default';
  return null;
}

const catalogQueries = {
  schemas: `
    /* catalog:schemas */
    SELECT namespace.nspname AS "schemaName"
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname !~ '^pg_'
      AND namespace.nspname <> 'information_schema'
      AND namespace.nspname <> '_ops'
    ORDER BY namespace.nspname ASC
  `,
  relations: `
    /* catalog:relations */
    SELECT
      namespace.nspname AS "schemaName",
      relation.relname AS "relationName",
      CASE relation.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned_table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized_view'
        WHEN 'f' THEN 'foreign_table'
      END AS kind,
      relation.relrowsecurity AS "rowSecurityEnabled",
      relation.relforcerowsecurity AS "forceRowSecurity"
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = ANY($1::text[])
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY namespace.nspname ASC, relation.relname ASC
  `,
  columns: `
    /* catalog:columns */
    SELECT
      namespace.nspname AS "schemaName",
      relation.relname AS "relationName",
      attribute.attname AS "columnName",
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS "dataType",
      NOT attribute.attnotnull AS nullable,
      attribute.atthasdef AS "hasDefault",
      attribute.attidentity AS identity,
      attribute.attgenerated AS generated
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = ANY($1::text[])
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ORDER BY namespace.nspname ASC, relation.relname ASC, attribute.attnum ASC
  `,
  constraints: `
    /* catalog:constraints */
    SELECT
      namespace.nspname AS "schemaName",
      relation.relname AS "relationName",
      constraint_record.conname AS "constraintName",
      CASE constraint_record.contype
        WHEN 'p' THEN 'primary_key'
        WHEN 'u' THEN 'unique'
        WHEN 'f' THEN 'foreign_key'
        WHEN 'c' THEN 'check'
      END AS kind,
      ARRAY(
        SELECT attribute.attname
        FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attribute_number, position)
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = relation.oid AND attribute.attnum = key_column.attribute_number
        ORDER BY key_column.position
      ) AS columns,
      referenced_namespace.nspname AS "referencedSchema",
      referenced_relation.relname AS "referencedRelation",
      ARRAY(
        SELECT attribute.attname
        FROM unnest(constraint_record.confkey) WITH ORDINALITY AS key_column(attribute_number, position)
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = referenced_relation.oid AND attribute.attnum = key_column.attribute_number
        ORDER BY key_column.position
      ) AS "referencedColumns",
      constraint_record.condeferrable AS deferrable,
      constraint_record.condeferred AS "initiallyDeferred"
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_catalog.pg_class AS referenced_relation ON referenced_relation.oid = constraint_record.confrelid
    LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
    WHERE namespace.nspname = ANY($1::text[])
      AND constraint_record.contype IN ('p', 'u', 'f', 'c')
    ORDER BY namespace.nspname ASC, relation.relname ASC, constraint_record.conname ASC
  `,
  indexes: `
    /* catalog:indexes */
    SELECT
      namespace.nspname AS "schemaName",
      relation.relname AS "relationName",
      index_relation.relname AS "indexName",
      access_method.amname AS method,
      ARRAY(
        SELECT attribute.attname
        FROM unnest(index_record.indkey) WITH ORDINALITY AS key_column(attribute_number, position)
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = relation.oid AND attribute.attnum = key_column.attribute_number
        WHERE key_column.attribute_number > 0
        ORDER BY key_column.position
      ) AS columns,
      index_record.indisunique AS unique,
      index_record.indisprimary AS primary,
      index_record.indisvalid AS valid,
      index_record.indexprs IS NOT NULL AS "hasExpressions",
      index_record.indpred IS NOT NULL AS "isPartial"
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = index_record.indrelid
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_relation.relam
    WHERE namespace.nspname = ANY($1::text[])
    ORDER BY namespace.nspname ASC, relation.relname ASC, index_relation.relname ASC
  `,
  triggers: `
    /* catalog:triggers */
    SELECT
      namespace.nspname AS "schemaName",
      relation.relname AS "relationName",
      trigger_record.tgname AS "triggerName",
      CASE
        WHEN trigger_record.tgtype & 2 = 2 THEN 'before'
        WHEN trigger_record.tgtype & 64 = 64 THEN 'instead_of'
        ELSE 'after'
      END AS timing,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN trigger_record.tgtype & 4 = 4 THEN 'insert' END,
        CASE WHEN trigger_record.tgtype & 8 = 8 THEN 'delete' END,
        CASE WHEN trigger_record.tgtype & 16 = 16 THEN 'update' END,
        CASE WHEN trigger_record.tgtype & 32 = 32 THEN 'truncate' END
      ], NULL) AS events,
      CASE trigger_record.tgenabled
        WHEN 'D' THEN 'disabled'
        WHEN 'R' THEN 'replica'
        WHEN 'A' THEN 'always'
        ELSE 'enabled'
      END AS enabled
    FROM pg_catalog.pg_trigger AS trigger_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = ANY($1::text[]) AND NOT trigger_record.tgisinternal
    ORDER BY namespace.nspname ASC, relation.relname ASC, trigger_record.tgname ASC
  `,
  policies: `
    /* catalog:policies */
    SELECT
      namespace.nspname AS "schemaName",
      relation.relname AS "relationName",
      policy_record.polname AS "policyName",
      CASE policy_record.polcmd
        WHEN 'r' THEN 'select'
        WHEN 'a' THEN 'insert'
        WHEN 'w' THEN 'update'
        WHEN 'd' THEN 'delete'
        ELSE 'all'
      END AS command,
      policy_record.polpermissive AS permissive,
      ARRAY(
        SELECT COALESCE(role_record.rolname, 'PUBLIC')
        FROM unnest(policy_record.polroles) AS policy_role(role_oid)
        LEFT JOIN pg_catalog.pg_roles AS role_record ON role_record.oid = policy_role.role_oid
        ORDER BY COALESCE(role_record.rolname, 'PUBLIC')
      ) AS roles
    FROM pg_catalog.pg_policy AS policy_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy_record.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = ANY($1::text[])
    ORDER BY namespace.nspname ASC, relation.relname ASC, policy_record.polname ASC
  `
} as const;

function createRelations(rows: RelationRow[]): Map<string, DatabaseRelation> {
  const relations = new Map<string, DatabaseRelation>();
  for (const row of rows) {
    relations.set(relationKey(row.schemaName, row.relationName), {
      name: row.relationName,
      kind: row.kind,
      rowLevelSecurity: { enabled: row.rowSecurityEnabled, forced: row.forceRowSecurity },
      columns: [],
      constraints: [],
      indexes: [],
      triggers: [],
      policies: []
    });
  }
  return relations;
}

function target(
  row: Pick<ConstraintRow, 'referencedSchema' | 'referencedRelation' | 'referencedColumns'>
): DatabaseConstraint['referencedRelation'] {
  if (!row.referencedSchema || !row.referencedRelation) return null;
  return {
    schema: row.referencedSchema,
    name: row.referencedRelation,
    columns: sortedStrings(row.referencedColumns)
  };
}

export async function readProductionSchema(input: {
  database: CatalogQueryDatabase;
}): Promise<DatabaseSchemaSnapshot> {
  await input.database.query('BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ');
  try {
    const { rows: schemaRows } = await input.database.query<{ schemaName: string }>(
      catalogQueries.schemas
    );
    const schemaNames = schemaRows.map((row) => row.schemaName).sort(compare);
    const { rows: relationRows } = schemaNames.length
      ? await input.database.query<RelationRow>(catalogQueries.relations, [schemaNames])
      : { rows: [] as RelationRow[] };
    const relations = createRelations(relationRows);
    const queryRows = async <T>(query: string): Promise<T[]> =>
      schemaNames.length ? (await input.database.query<T>(query, [schemaNames])).rows : [];
    const [columns, constraints, indexes, triggers, policies] = await Promise.all([
      queryRows<ColumnRow>(catalogQueries.columns),
      queryRows<ConstraintRow>(catalogQueries.constraints),
      queryRows<IndexRow>(catalogQueries.indexes),
      queryRows<TriggerRow>(catalogQueries.triggers),
      queryRows<PolicyRow>(catalogQueries.policies)
    ]);

    for (const row of columns) {
      relations.get(relationKey(row.schemaName, row.relationName))?.columns.push({
        name: row.columnName,
        dataType: row.dataType,
        nullable: row.nullable,
        hasDefault: row.hasDefault,
        identity: identity(row.identity),
        generated: row.generated !== ''
      });
    }
    for (const row of constraints) {
      relations.get(relationKey(row.schemaName, row.relationName))?.constraints.push({
        name: row.constraintName,
        kind: row.kind,
        columns: sortedStrings(row.columns),
        referencedRelation: target(row),
        deferrable: row.deferrable,
        initiallyDeferred: row.initiallyDeferred
      });
    }
    for (const row of indexes) {
      relations.get(relationKey(row.schemaName, row.relationName))?.indexes.push({
        name: row.indexName,
        method: row.method,
        columns: sortedStrings(row.columns),
        unique: row.unique,
        primary: row.primary,
        valid: row.valid,
        hasExpressions: row.hasExpressions,
        partial: row.isPartial
      });
    }
    for (const row of triggers) {
      relations.get(relationKey(row.schemaName, row.relationName))?.triggers.push({
        name: row.triggerName,
        timing: row.timing,
        events: sortedStrings(row.events) as DatabaseTrigger['events'],
        enabled: row.enabled
      });
    }
    for (const row of policies) {
      relations.get(relationKey(row.schemaName, row.relationName))?.policies.push({
        name: row.policyName,
        command: row.command,
        permissive: row.permissive,
        roles: sortedStrings(row.roles)
      });
    }

    const schemas: DatabaseSchema[] = schemaNames.map((name) => ({
      name,
      relations: [...relations.entries()]
        .filter(([key]) => key.startsWith(`${name}\u0000`))
        .map(([, relation]) => ({
          ...relation,
          columns: relation.columns.sort((left, right) => compare(left.name, right.name)),
          constraints: relation.constraints.sort((left, right) => compare(left.name, right.name)),
          indexes: relation.indexes.sort((left, right) => compare(left.name, right.name)),
          triggers: relation.triggers.sort((left, right) => compare(left.name, right.name)),
          policies: relation.policies.sort((left, right) => compare(left.name, right.name))
        }))
        .sort((left, right) => compare(left.name, right.name))
    }));
    const structural = { schemas };
    return {
      ...structural,
      checksum: createHash('sha256').update(JSON.stringify(structural), 'utf8').digest('hex')
    };
  } finally {
    await input.database.query('ROLLBACK');
  }
}

export function createProductionSchemaReader(input: {
  pool: CatalogPool;
  identity: { role: string; database: string };
  now?: () => Date;
  cacheTtlMs?: number;
}): () => Promise<DatabaseSchemaSnapshot> {
  const cache = new Map<string, { expiresAt: number; snapshot: DatabaseSchemaSnapshot }>();
  const key = `${input.identity.role}\u0000${input.identity.database}`;
  const now = input.now ?? (() => new Date());
  const cacheTtlMs = input.cacheTtlMs ?? 60_000;
  return async () => {
    const cached = cache.get(key);
    if (cached && now().getTime() < cached.expiresAt) return cached.snapshot;
    const connection = await input.pool.connect();
    try {
      const snapshot = await readProductionSchema({ database: connection });
      cache.set(key, { snapshot, expiresAt: now().getTime() + cacheTtlMs });
      return snapshot;
    } finally {
      connection.release();
    }
  };
}
