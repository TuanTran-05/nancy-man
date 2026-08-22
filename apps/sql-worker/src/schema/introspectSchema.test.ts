import { describe, expect, it } from 'vitest';

import { createProductionSchemaReader, readProductionSchema } from './introspectSchema.js';

type QueryCall = { sql: string; values?: readonly unknown[] };

function createCatalogDatabase() {
  const calls: QueryCall[] = [];
  return {
    calls,
    database: {
      query: async <T>(sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, ...(values === undefined ? {} : { values }) });
        if (sql.includes('catalog:schemas')) {
          return { rows: [{ schemaName: 'school' }, { schemaName: 'app' }] as T[] };
        }
        if (sql.includes('catalog:relations')) {
          return {
            rows: [
              {
                schemaName: 'app',
                relationName: 'enrollments',
                kind: 'table',
                rowSecurityEnabled: false,
                forceRowSecurity: false
              },
              {
                schemaName: 'school',
                relationName: 'students',
                kind: 'table',
                rowSecurityEnabled: true,
                forceRowSecurity: false
              }
            ] as T[]
          };
        }
        if (sql.includes('catalog:columns')) {
          return {
            rows: [
              {
                schemaName: 'school',
                relationName: 'students',
                columnName: 'name',
                dataType: 'text',
                nullable: false,
                hasDefault: false,
                identity: '',
                generated: ''
              },
              {
                schemaName: 'school',
                relationName: 'students',
                columnName: 'id',
                dataType: 'uuid',
                nullable: false,
                hasDefault: true,
                identity: '',
                generated: ''
              }
            ] as T[]
          };
        }
        if (sql.includes('catalog:constraints')) {
          return {
            rows: [
              {
                schemaName: 'school',
                relationName: 'students',
                constraintName: 'students_pkey',
                kind: 'primary_key',
                columns: ['id'],
                referencedSchema: null,
                referencedRelation: null,
                referencedColumns: [],
                deferrable: false,
                initiallyDeferred: false
              }
            ] as T[]
          };
        }
        if (sql.includes('catalog:indexes')) {
          return {
            rows: [
              {
                schemaName: 'school',
                relationName: 'students',
                indexName: 'students_name_idx',
                method: 'btree',
                columns: ['name'],
                unique: false,
                primary: false,
                valid: true,
                hasExpressions: false,
                isPartial: false
              }
            ] as T[]
          };
        }
        if (sql.includes('catalog:triggers')) {
          return {
            rows: [
              {
                schemaName: 'school',
                relationName: 'students',
                triggerName: 'students_audit',
                timing: 'after',
                events: ['insert', 'update'],
                enabled: 'enabled'
              }
            ] as T[]
          };
        }
        if (sql.includes('catalog:policies')) {
          return {
            rows: [
              {
                schemaName: 'school',
                relationName: 'students',
                policyName: 'students_select',
                command: 'select',
                permissive: true,
                roles: ['ops_production_reader']
              }
            ] as T[]
          };
        }
        return { rows: [] as T[] };
      }
    }
  };
}

describe('readProductionSchema', () => {
  it('returns a stable, structural snapshot without source expressions or function bodies', async () => {
    const { calls, database } = createCatalogDatabase();

    const snapshot = await readProductionSchema({ database });

    expect(snapshot.schemas).toEqual([
      {
        name: 'app',
        relations: [
          {
            name: 'enrollments',
            kind: 'table',
            rowLevelSecurity: { enabled: false, forced: false },
            columns: [],
            constraints: [],
            indexes: [],
            triggers: [],
            policies: []
          }
        ]
      },
      {
        name: 'school',
        relations: [
          {
            name: 'students',
            kind: 'table',
            rowLevelSecurity: { enabled: true, forced: false },
            columns: [
              {
                name: 'id',
                dataType: 'uuid',
                nullable: false,
                hasDefault: true,
                identity: null,
                generated: false
              },
              {
                name: 'name',
                dataType: 'text',
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false
              }
            ],
            constraints: [
              {
                name: 'students_pkey',
                kind: 'primary_key',
                columns: ['id'],
                referencedRelation: null,
                deferrable: false,
                initiallyDeferred: false
              }
            ],
            indexes: [
              {
                name: 'students_name_idx',
                method: 'btree',
                columns: ['name'],
                unique: false,
                primary: false,
                valid: true,
                hasExpressions: false,
                partial: false
              }
            ],
            triggers: [
              {
                name: 'students_audit',
                timing: 'after',
                events: ['insert', 'update'],
                enabled: 'enabled'
              }
            ],
            policies: [
              {
                name: 'students_select',
                command: 'select',
                permissive: true,
                roles: ['ops_production_reader']
              }
            ]
          }
        ]
      }
    ]);
    expect(snapshot.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain('pg_get_expr');
    expect(JSON.stringify(snapshot)).not.toContain('function_body');
    expect(calls[0]?.sql).toContain('BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ');
    expect(calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(calls.find((call) => call.sql.includes('catalog:schemas'))?.sql).toContain(
      "nspname <> '_ops'"
    );
    const catalogSql = calls.map((call) => call.sql).join('\n');
    expect(catalogSql).not.toContain('pg_get_expr');
    expect(catalogSql).not.toContain('pg_get_functiondef');
    expect(catalogSql).not.toContain('pg_description');
    for (const call of calls.filter(
      (value) => value.sql.includes('catalog:') && !value.sql.includes('catalog:schemas')
    )) {
      expect(call.values).toEqual([['app', 'school']]);
    }
  });

  it('caches a database-identity snapshot for at most sixty seconds and releases its connection', async () => {
    const { calls, database } = createCatalogDatabase();
    let released = 0;
    let now = new Date('2026-08-22T00:00:00.000Z');
    const read = createProductionSchemaReader({
      pool: {
        connect: async () => ({ ...database, release: () => void released++ })
      },
      identity: { role: 'ops_production_reader', database: 'edutrack_production' },
      now: () => now
    });

    const first = await read();
    const second = await read();
    now = new Date('2026-08-22T00:01:01.000Z');
    const third = await read();

    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(released).toBe(2);
    expect(calls.filter((call) => call.sql.includes('catalog:schemas'))).toHaveLength(2);
  });
});
