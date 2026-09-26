import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import {
  type DatabaseExplorerColumn,
  type DatabaseExplorerRelation,
  type DatabaseExplorerSchema,
  type DatabaseExplorerSchemaSnapshot,
  type DatabaseFilterOperator,
  type DatabaseRelationEdge
} from '../../../../packages/contracts/src/databaseExplorer.js';
import {
  classifyColumn,
  DATABASE_POLICY_VERSION
} from '../../../../packages/security/src/database/columnPolicy.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import { readProductionSchema } from '../schema/introspectSchema.js';
import { makeExplorerError } from './filterSql.js';
import type { DatabasePolicyApproval } from './policyApproval.js';

const TEXT_TYPES = new Set([
  'text',
  'varchar',
  'character varying',
  'char',
  'character',
  'uuid',
  'citext',
  'name',
  'bpchar'
]);

const NUMERIC_TYPES = new Set([
  'int',
  'int2',
  'int4',
  'int8',
  'integer',
  'smallint',
  'bigint',
  'decimal',
  'numeric',
  'real',
  'double precision',
  'float',
  'float4',
  'float8',
  'serial',
  'bigserial',
  'smallserial',
  'money'
]);

const TEMPORAL_TYPES = new Set([
  'date',
  'time',
  'timetz',
  'time without time zone',
  'time with time zone',
  'timestamp',
  'timestamptz',
  'timestamp without time zone',
  'timestamp with time zone',
  'interval'
]);

const BOOLEAN_TYPES = new Set(['bool', 'boolean']);

function getFilterOperators(
  dataType: string,
  classification: string,
  isEnum: boolean
): DatabaseFilterOperator[] {
  if (classification === 'blocked') {
    return [];
  }

  if (isEnum) return ['eq', 'neq', 'is_null', 'is_not_null'];

  const baseType = dataType
    .toLowerCase()
    .replace(/\(.*\)/, '')
    .trim();

  if (TEXT_TYPES.has(baseType)) {
    return ['eq', 'neq', 'contains', 'is_null', 'is_not_null'];
  }
  if (NUMERIC_TYPES.has(baseType)) {
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
  }
  if (TEMPORAL_TYPES.has(baseType)) {
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
  }
  if (BOOLEAN_TYPES.has(baseType)) {
    return ['eq', 'neq', 'is_null', 'is_not_null'];
  }

  return ['is_null', 'is_not_null'];
}

type CachedSchema = { expiresAt: number; snapshot: DatabaseExplorerSchemaSnapshot };
type SchemaCache = Map<string, CachedSchema>;
const targetSchemaCaches = new Map<string, Set<SchemaCache>>();

function targetCacheKey(
  target: Pick<AvailableTargetEntry, 'id' | 'role' | 'databaseName'>
): string {
  return `${target.id}\u0000${target.role}\u0000${target.databaseName}\u0000${DATABASE_POLICY_VERSION}`;
}

export function invalidateExplorerSchemaCache(
  target: Pick<AvailableTargetEntry, 'id' | 'role' | 'databaseName'>
): void {
  for (const cache of targetSchemaCaches.get(targetCacheKey(target)) ?? []) cache.clear();
}

export function createExplorerSchemaReader(input: {
  target: AvailableTargetEntry;
  getPolicyApproval?: () => DatabasePolicyApproval | undefined;
  now?: () => Date;
  cacheTtlMs?: number;
}): () => Promise<DatabaseExplorerSchemaSnapshot> {
  const cache: SchemaCache = new Map();
  const cacheKey = targetCacheKey(input.target);
  const registeredCaches = targetSchemaCaches.get(cacheKey) ?? new Set<SchemaCache>();
  registeredCaches.add(cache);
  targetSchemaCaches.set(cacheKey, registeredCaches);
  const now = input.now ?? (() => new Date());
  const cacheTtlMs = Math.min(input.cacheTtlMs ?? 60_000, 60_000);

  return async () => {
    const cached = cache.get(cacheKey);
    if (cached && now().getTime() < cached.expiresAt) {
      return cached.snapshot;
    }

    let connection;
    try {
      connection = await input.target.pool.connect();
    } catch (caught) {
      captureOpsException(caught, {
        code: 'DATABASE_SCHEMA_CHECK_FAILED',
        source: 'database',
        status: 500,
        errorMode: 'code-only'
      });
      cache.delete(cacheKey);
      throw makeExplorerError('DATABASE_SCHEMA_CHECK_FAILED');
    }

    try {
      const baseSnapshot = await readProductionSchema({ database: connection });
      const approval = input.getPolicyApproval?.();
      const policyApproved = Boolean(
        approval &&
        approval.version === DATABASE_POLICY_VERSION &&
        approval.targets?.[input.target.id] === baseSnapshot.checksum
      );

      // Query estimated rows
      const schemaNames = baseSnapshot.schemas.map((s) => s.name);
      let estimatedRowsRows: Array<{
        schemaName: string;
        relationName: string;
        estimatedRows: number | string;
      }> = [];
      try {
        const result = await connection.query<{
          schemaName: string;
          relationName: string;
          estimatedRows: number | string;
        }>(
          `
          /* catalog:estimated_rows */
          SELECT
            namespace.nspname AS "schemaName",
            relation.relname AS "relationName",
            GREATEST(0, relation.reltuples::bigint) AS "estimatedRows"
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = ANY($1::text[])
          `,
          [schemaNames]
        );
        estimatedRowsRows = result.rows;
      } catch (caught) {
        captureOpsException(caught, {
          code: 'DATABASE_SCHEMA_METADATA_FAILED',
          source: 'job',
          status: 500,
          errorMode: 'code-only'
        });
      }

      const estimatedRowsMap = new Map<string, number>();
      for (const row of estimatedRowsRows) {
        const val = Number(row.estimatedRows);
        estimatedRowsMap.set(
          `${row.schemaName}\u0000${row.relationName}`,
          Number.isFinite(val) ? val : 0
        );
      }

      const enumColumnKeys = new Set<string>();
      if (schemaNames.length > 0) {
        const enumColumns = await connection.query<{
          schemaName: string;
          relationName: string;
          columnName: string;
        }>(
          `
          /* catalog:enum_columns */
          SELECT
            namespace.nspname AS "schemaName",
            relation.relname AS "relationName",
            attribute.attname AS "columnName"
          FROM pg_catalog.pg_attribute AS attribute
          JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          JOIN pg_catalog.pg_type AS enum_type ON enum_type.oid = attribute.atttypid
          WHERE namespace.nspname = ANY($1::text[])
            AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
            AND enum_type.typtype = 'e'
          `,
          [schemaNames]
        );
        for (const row of enumColumns.rows) {
          enumColumnKeys.add(`${row.schemaName}\u0000${row.relationName}\u0000${row.columnName}`);
        }
      }

      // Foreign key edges
      const edges: DatabaseRelationEdge[] = [];
      for (const schema of baseSnapshot.schemas) {
        for (const relation of schema.relations) {
          for (const constraint of relation.constraints) {
            if (
              constraint.kind === 'foreign_key' &&
              constraint.referencedRelation &&
              constraint.referencedRelation.schema &&
              constraint.referencedRelation.name
            ) {
              edges.push({
                constraint: constraint.name,
                from: {
                  schema: schema.name,
                  relation: relation.name,
                  columns: [...constraint.columns]
                },
                to: {
                  schema: constraint.referencedRelation.schema,
                  relation: constraint.referencedRelation.name,
                  columns: [...constraint.referencedRelation.columns]
                }
              });
            }
          }
        }
      }
      edges.sort((a, b) => a.constraint.localeCompare(b.constraint));

      // Build explorer schemas
      const explorerSchemas: DatabaseExplorerSchema[] = baseSnapshot.schemas.map((schema) => {
        const relations: DatabaseExplorerRelation[] = schema.relations.map((relation) => {
          // Primary key
          const pkConstraint = relation.constraints.find((c) => c.kind === 'primary_key');
          const primaryKey =
            pkConstraint && pkConstraint.columns.length > 0 ? [...pkConstraint.columns] : null;

          // Non-null column names set
          const nonNullableCols = new Set(
            relation.columns.filter((c) => !c.nullable).map((c) => c.name)
          );

          // Pagination key
          let paginationKey: string[] | null = null;
          if (primaryKey && primaryKey.every((col) => nonNullableCols.has(col))) {
            paginationKey = primaryKey;
          } else {
            // Find valid unique index with all non-null columns
            const candidates = relation.indexes
              .filter(
                (idx) =>
                  idx.unique &&
                  idx.valid &&
                  !idx.hasExpressions &&
                  !idx.partial &&
                  idx.columns.length > 0 &&
                  idx.columns.every((col) => nonNullableCols.has(col))
              )
              .sort((a, b) => {
                if (a.columns.length !== b.columns.length) {
                  return a.columns.length - b.columns.length;
                }
                return a.name.localeCompare(b.name);
              });

            if (candidates[0]) {
              paginationKey = [...candidates[0].columns];
            }
          }

          // Data available
          const dataAvailable = relation.kind !== 'foreign_table' && policyApproved;

          // Estimated rows
          const estimatedRows =
            estimatedRowsMap.get(`${schema.name}\u0000${relation.name}`) ?? null;

          // Columns
          const columns: DatabaseExplorerColumn[] = relation.columns.map((col) => {
            const classification = policyApproved
              ? classifyColumn({
                  targetId: input.target.id,
                  schema: schema.name,
                  relation: relation.name,
                  column: col.name
                })
              : 'blocked';
            const selectable = classification !== 'blocked';
            const filterOperators = getFilterOperators(
              col.dataType,
              classification,
              enumColumnKeys.has(`${schema.name}\u0000${relation.name}\u0000${col.name}`)
            );

            return {
              name: col.name,
              dataType: col.dataType,
              nullable: col.nullable,
              hasDefault: col.hasDefault,
              identity: col.identity,
              generated: col.generated,
              classification,
              selectable,
              filterOperators
            };
          });

          if (
            paginationKey &&
            paginationKey.some(
              (keyColumn) =>
                !columns.some((column) => column.name === keyColumn && column.selectable)
            )
          ) {
            paginationKey = null;
          }

          return {
            name: relation.name,
            kind: relation.kind,
            rowLevelSecurity: relation.rowLevelSecurity,
            columns,
            constraints: relation.constraints,
            indexes: relation.indexes,
            triggers: relation.triggers,
            policies: relation.policies,
            estimatedRows,
            dataAvailable,
            primaryKey,
            paginationKey
          };
        });

        return {
          name: schema.name,
          relations
        };
      });

      const snapshot: DatabaseExplorerSchemaSnapshot = {
        targetId: input.target.id,
        targetLabel: input.target.label,
        checksum: baseSnapshot.checksum,
        policyVersion: DATABASE_POLICY_VERSION,
        schemas: explorerSchemas,
        edges
      };

      cache.set(cacheKey, { snapshot, expiresAt: now().getTime() + cacheTtlMs });
      return snapshot;
    } catch (caught) {
      captureOpsException(caught, {
        code: 'DATABASE_SCHEMA_CHECK_FAILED',
        source: 'database',
        status: 500,
        errorMode: 'code-only'
      });
      cache.delete(cacheKey);
      throw makeExplorerError('DATABASE_SCHEMA_CHECK_FAILED');
    } finally {
      connection.release();
    }
  };
}
