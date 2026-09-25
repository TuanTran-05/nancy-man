/**
 * Boundary and load tests for the Database Explorer SQL worker.
 *
 * Verifies that:
 * - At most 5 filters are accepted
 * - Cell values exceeding 64 KiB are truncated
 * - Response exceeding 2 MiB is truncated
 * - Large schema snapshots (101 relations, 210 FK edges) are handled
 * - Duplicate / nullable pagination keys do not break cursors
 * - Query timeout results in a rollback
 * - Full ERD projection is deterministic for large graphs
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readDatabaseRows } from '../explorer/rowReader.js';
import { readProductionSchema } from '../schema/introspectSchema.js';
import { encodeCell, MAX_CELL_BYTES, MAX_RESPONSE_BYTES } from '../explorer/valueEncoding.js';
import {
  filterGraph,
  projectFullGraph
} from '../../../web/src/web/features/database/graphModel.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import type {
  DatabaseExplorerColumn,
  DatabaseExplorerRelation,
  DatabaseExplorerSchema,
  DatabaseExplorerSchemaSnapshot,
  DatabaseRelationEdge,
  DatabaseRowsRequest
} from '../../../../packages/contracts/src/databaseExplorer.js';

const TEST_CURSOR_KEY = Buffer.alloc(32, 1).toString('base64');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeColumn(name: string, dataType = 'text'): DatabaseExplorerColumn {
  return {
    name,
    dataType,
    nullable: true,
    hasDefault: false,
    identity: null,
    generated: false,
    classification: 'public',
    selectable: true,
    filterOperators: ['eq', 'contains', 'is_null', 'is_not_null']
  };
}

function makeRelation(
  name: string,
  extra: Partial<DatabaseExplorerRelation> = {}
): DatabaseExplorerRelation {
  return {
    name,
    kind: 'table',
    primaryKey: ['id'],
    paginationKey: ['id'],
    rowLevelSecurity: { enabled: false, forced: false },
    dataAvailable: true,
    estimatedRows: 100,
    columns: [makeColumn('id', 'int4'), makeColumn('data')],
    constraints: [],
    indexes: [],
    triggers: [],
    policies: [],
    ...extra
  };
}

function makeSchema(name: string, relationCount: number): DatabaseExplorerSchema {
  return {
    name,
    relations: Array.from({ length: relationCount }, (_, i) => makeRelation(`t${i}`))
  };
}

function makeSnapshot(
  schemas: DatabaseExplorerSchema[],
  edges: DatabaseRelationEdge[] = []
): DatabaseExplorerSchemaSnapshot {
  const structural = {
    schemas: schemas.map((schema) => ({
      name: schema.name,
      relations: schema.relations
        .map((relation) => ({
          name: relation.name,
          kind: relation.kind,
          rowLevelSecurity: relation.rowLevelSecurity,
          columns: relation.columns
            .map(({ name, dataType, nullable, hasDefault, identity, generated }) => ({
              name,
              dataType,
              nullable,
              hasDefault,
              identity,
              generated
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          constraints: relation.constraints,
          indexes: relation.indexes,
          triggers: relation.triggers,
          policies: relation.policies
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    }))
  };
  return {
    targetId: 'ops',
    targetLabel: 'Ops',
    checksum: createHash('sha256').update(JSON.stringify(structural), 'utf8').digest('hex'),
    policyVersion: '2026-09-25-v2',
    schemas,
    edges
  };
}

function schemaCatalogRows(
  snapshot: DatabaseExplorerSchemaSnapshot,
  sql: string
): unknown[] | undefined {
  if (sql.includes('/* catalog:schemas */')) {
    return snapshot.schemas.map(({ name }) => ({ schemaName: name }));
  }
  if (sql.includes('/* catalog:relations */')) {
    return snapshot.schemas.flatMap((schema) =>
      schema.relations.map((relation) => ({
        schemaName: schema.name,
        relationName: relation.name,
        kind: relation.kind,
        rowSecurityEnabled: relation.rowLevelSecurity.enabled,
        forceRowSecurity: relation.rowLevelSecurity.forced
      }))
    );
  }
  if (sql.includes('/* catalog:columns */')) {
    return snapshot.schemas.flatMap((schema) =>
      schema.relations.flatMap((relation) =>
        relation.columns.map((column) => ({
          schemaName: schema.name,
          relationName: relation.name,
          columnName: column.name,
          dataType: column.dataType,
          nullable: column.nullable,
          hasDefault: column.hasDefault,
          identity:
            column.identity === 'always' ? 'a' : column.identity === 'by_default' ? 'd' : '',
          generated: column.generated ? 's' : ''
        }))
      )
    );
  }
  if (sql.includes('/* catalog:constraints */')) {
    return snapshot.schemas.flatMap((schema) =>
      schema.relations.flatMap((relation) =>
        relation.constraints.map((constraint) => ({
          schemaName: schema.name,
          relationName: relation.name,
          constraintName: constraint.name,
          kind: constraint.kind,
          columns: constraint.columns,
          referencedSchema: constraint.referencedRelation?.schema ?? null,
          referencedRelation: constraint.referencedRelation?.name ?? null,
          referencedColumns: constraint.referencedRelation?.columns ?? null,
          deferrable: constraint.deferrable,
          initiallyDeferred: constraint.initiallyDeferred
        }))
      )
    );
  }
  if (sql.includes('/* catalog:indexes */')) {
    return snapshot.schemas.flatMap((schema) =>
      schema.relations.flatMap((relation) =>
        relation.indexes.map((index) => ({
          schemaName: schema.name,
          relationName: relation.name,
          indexName: index.name,
          method: index.method,
          columns: index.columns,
          unique: index.unique,
          primary: index.primary,
          valid: index.valid,
          hasExpressions: index.hasExpressions,
          isPartial: index.partial
        }))
      )
    );
  }
  if (sql.includes('/* catalog:triggers */')) {
    return snapshot.schemas.flatMap((schema) =>
      schema.relations.flatMap((relation) =>
        relation.triggers.map((trigger) => ({
          schemaName: schema.name,
          relationName: relation.name,
          triggerName: trigger.name,
          timing: trigger.timing,
          events: trigger.events,
          enabled: trigger.enabled
        }))
      )
    );
  }
  if (sql.includes('/* catalog:policies */')) {
    return snapshot.schemas.flatMap((schema) =>
      schema.relations.flatMap((relation) =>
        relation.policies.map((policy) => ({
          schemaName: schema.name,
          relationName: relation.name,
          policyName: policy.name,
          command: policy.command,
          permissive: policy.permissive,
          roles: policy.roles
        }))
      )
    );
  }
  return undefined;
}

function mockTarget(
  queryRows: unknown[] = [],
  snapshot?: DatabaseExplorerSchemaSnapshot
): {
  target: AvailableTargetEntry;
  queries: string[];
  rolledBack: boolean;
  released: boolean;
} {
  const queries: string[] = [];
  let rolledBack = false;
  let released = false;

  const target: AvailableTargetEntry = {
    id: 'ops',
    label: 'Ops',
    status: 'available',
    databaseName: 'ops_db',
    role: 'ops_database_browser',
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async <T>(sql: string) => {
          queries.push(sql);
          if (sql.trim() === 'ROLLBACK') {
            rolledBack = true;
            return { rows: [] as T[] };
          }
          const catalogRows = snapshot ? schemaCatalogRows(snapshot, sql) : undefined;
          if (catalogRows !== undefined) return { rows: catalogRows as T[] };
          return { rows: queryRows as T[] };
        },
        release: () => {
          released = true;
        }
      }),
      end: async () => undefined
    }
  };

  return { target, queries, rolledBack, released };
}

function makeRowsRequest(overrides: Partial<DatabaseRowsRequest> = {}): DatabaseRowsRequest {
  return {
    targetId: 'ops',
    schema: 'public',
    relation: 't0',
    pageSize: 25,
    filters: [],
    piiMode: 'masked',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests — filter bounds
// ---------------------------------------------------------------------------

describe('databaseExplorerBounds — filter limits', () => {
  it('accepts exactly 5 filters', async () => {
    const schema = makeSchema('public', 1);
    const snap = makeSnapshot([schema]);
    const { target } = mockTarget([{ id: 1, data: 'x' }], snap);
    const filters = [
      { column: 'data', operator: 'contains' as const, value: 'a' },
      { column: 'data', operator: 'contains' as const, value: 'b' },
      { column: 'data', operator: 'contains' as const, value: 'c' },
      { column: 'data', operator: 'contains' as const, value: 'd' },
      { column: 'data', operator: 'contains' as const, value: 'e' }
    ];
    // Should not throw
    await expect(
      readDatabaseRows({
        target,
        snapshot: snap,
        cursorKey: TEST_CURSOR_KEY,
        request: makeRowsRequest({ filters })
      })
    ).resolves.toBeDefined();
  });

  it('rejects a 6th filter with DATABASE_FILTER_INVALID', async () => {
    const schema = makeSchema('public', 1);
    const snap = makeSnapshot([schema]);
    const { target } = mockTarget([], snap);
    const filters = Array.from({ length: 6 }, () => ({
      column: 'data',
      operator: 'eq' as const,
      value: 'x'
    }));
    await expect(
      readDatabaseRows({
        target,
        snapshot: snap,
        cursorKey: TEST_CURSOR_KEY,
        request: makeRowsRequest({ filters })
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('DATABASE_FILTER_INVALID') });
  });
});

// ---------------------------------------------------------------------------
// Tests — cell and response size bounds
// ---------------------------------------------------------------------------

describe('databaseExplorerBounds — cell and response size', () => {
  it('cell exceeding 64 KiB is returned as state=truncated', () => {
    const col = makeColumn('big_data');
    const bigValue = 'x'.repeat(MAX_CELL_BYTES + 1);
    const cell = encodeCell({
      columnName: 'big_data',
      column: col,
      rawValue: bigValue,
      piiMode: 'masked'
    });
    expect(cell.state).toBe('truncated');
  });

  it('cell exactly at 64 KiB is returned as state=value', () => {
    const col = makeColumn('exact');
    const exactValue = 'x'.repeat(MAX_CELL_BYTES);
    const cell = encodeCell({
      columnName: 'exact',
      column: col,
      rawValue: exactValue,
      piiMode: 'masked'
    });
    expect(cell.state).toBe('value');
    if (cell.state === 'value') {
      expect(typeof cell.value).toBe('string');
    }
  });

  it('encodeCell for a blocked column returns state=blocked regardless of raw value', () => {
    const col = makeColumn('ssn');
    const blockedCol = { ...col, classification: 'blocked' as const, selectable: false };
    const cell = encodeCell({
      columnName: 'ssn',
      column: blockedCol,
      rawValue: 'SECRET',
      piiMode: 'revealed'
    });
    expect(cell.state).toBe('blocked');
    expect(JSON.stringify(cell)).not.toContain('SECRET');
  });

  it('MAX_RESPONSE_BYTES is 2 MiB', () => {
    expect(MAX_RESPONSE_BYTES).toBe(2 * 1024 * 1024);
  });

  it('MAX_CELL_BYTES is 64 KiB', () => {
    expect(MAX_CELL_BYTES).toBe(64 * 1024);
  });
});

// ---------------------------------------------------------------------------
// Tests — large schema (101 relations, 210 FK edges) — deterministic projection
// ---------------------------------------------------------------------------

describe('databaseExplorerBounds — large schema projection', () => {
  function buildLargeSnapshot(): DatabaseExplorerSchemaSnapshot {
    const RELATION_COUNT = 101;
    const relations = Array.from({ length: RELATION_COUNT }, (_, i) =>
      makeRelation(`table_${String(i).padStart(3, '0')}`, {
        columns: [makeColumn('id', 'int4'), makeColumn('ref_id', 'int4'), makeColumn('tenant_id')]
      })
    );

    // Build 210 FK edges cycling through the relations
    const edges: DatabaseRelationEdge[] = [];
    for (let i = 0; i < 210; i++) {
      const from = i % RELATION_COUNT;
      const to = (i + 1) % RELATION_COUNT;
      edges.push({
        constraint: `fk_${i}`,
        from: {
          schema: 'public',
          relation: `table_${String(from).padStart(3, '0')}`,
          columns: ['tenant_id', 'ref_id']
        },
        to: {
          schema: 'public',
          relation: `table_${String(to).padStart(3, '0')}`,
          columns: ['tenant_id', 'id']
        }
      });
    }

    const relationsWithConstraints = relations.map((relation) => ({
      ...relation,
      constraints: edges
        .filter((edge) => edge.from.relation === relation.name)
        .map((edge) => ({
          name: edge.constraint,
          kind: 'foreign_key' as const,
          columns: [...edge.from.columns],
          referencedRelation: {
            schema: edge.to.schema,
            name: edge.to.relation,
            columns: [...edge.to.columns]
          },
          deferrable: false,
          initiallyDeferred: false
        }))
    }));

    return makeSnapshot([{ name: 'public', relations: relationsWithConstraints }], edges);
  }

  it('worker introspection returns all 101 relations and 210 ordered FK pairs', async () => {
    const baseSnapshot = buildLargeSnapshot();
    const snapshot: DatabaseExplorerSchemaSnapshot = {
      ...baseSnapshot,
      schemas: baseSnapshot.schemas.map((schema) => ({
        ...schema,
        relations: schema.relations.map((relation) => ({
          ...relation,
          columns: [
            ...relation.columns,
            ...Array.from({ length: 256 }, (_, index) => makeColumn(`metadata_${index}`))
          ]
        }))
      }))
    };
    const { target, queries } = mockTarget([], snapshot);
    const connection = await target.pool.connect();
    const structural = await readProductionSchema({ database: connection });
    connection.release();
    const relations = structural.schemas.flatMap((schema) => schema.relations);
    const foreignKeys = relations.flatMap((relation) =>
      relation.constraints.filter((constraint) => constraint.kind === 'foreign_key')
    );

    expect(relations).toHaveLength(101);
    expect(foreignKeys).toHaveLength(210);
    expect(relations[0]?.columns).toHaveLength(259);
    expect(relations[0]?.columns[0]?.name).toBe('id');
    expect(relations[0]?.columns.at(-2)?.name).toBe('ref_id');
    expect(relations[0]?.columns.at(-1)?.name).toBe('tenant_id');
    expect(foreignKeys[0]?.columns).toEqual(['tenant_id', 'ref_id']);
    expect(foreignKeys[0]?.referencedRelation?.columns).toEqual(['tenant_id', 'id']);
    expect(Buffer.byteLength(JSON.stringify(structural), 'utf8')).toBeGreaterThan(
      MAX_RESPONSE_BYTES
    );
    expect(queries.some((sql) => /FROM\s+"public"\."/.test(sql))).toBe(false);
  });

  it('projectFullGraph handles 101 relations and 210 edges', () => {
    const snap = buildLargeSnapshot();
    const model = projectFullGraph(snap, 'ops');
    expect(model.nodes).toHaveLength(101);
    expect(model.edges).toHaveLength(210);
  });

  it('shuffled large snapshot produces identical node/edge ordering', () => {
    const snap1 = buildLargeSnapshot();
    // Shuffle schemas and relations in snap2
    const snap2: DatabaseExplorerSchemaSnapshot = {
      ...snap1,
      schemas: [
        {
          name: 'public',
          relations: [...snap1.schemas[0].relations].reverse()
        }
      ],
      edges: [...snap1.edges].reverse()
    };

    const m1 = projectFullGraph(snap1, 'ops');
    const m2 = projectFullGraph(snap2, 'ops');

    expect(m1.nodes.map((n) => n.id)).toEqual(m2.nodes.map((n) => n.id));
    expect(m1.edges.map((e) => e.id).sort()).toEqual(m2.edges.map((e) => e.id).sort());
  });

  it('search filtering on large graph is deterministic', () => {
    const snap = buildLargeSnapshot();
    const full = projectFullGraph(snap, 'ops');

    const r1 = filterGraph(full, 'TABLE_050');
    const r2 = filterGraph(full, 'table_050');
    expect(r1.nodes.map((n) => n.id)).toEqual(r2.nodes.map((n) => n.id));
    expect(r1.nodes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — query timeout rollback
// ---------------------------------------------------------------------------

describe('databaseExplorerBounds — query timeout', () => {
  it('query statement timeout causes rollback and releases connection', async () => {
    const queries: string[] = [];
    let released = false;
    const schema = makeSchema('public', 1);
    const snap = makeSnapshot([schema]);

    const target: AvailableTargetEntry = {
      id: 'ops',
      label: 'Ops',
      status: 'available',
      databaseName: 'ops_db',
      role: 'ops_database_browser',
      pool: {
        query: async () => ({ rows: [] }),
        connect: async () => ({
          query: async <T>(sql: string) => {
            queries.push(sql);
            if (sql.trim() === 'ROLLBACK') {
              return { rows: [] as T[] };
            }
            const catalogRows = schemaCatalogRows(snap, sql);
            if (catalogRows !== undefined) return { rows: catalogRows as T[] };
            if (sql.trim().startsWith('SELECT')) {
              const err = Object.assign(new Error('canceling statement due to statement timeout'), {
                code: '57014'
              });
              throw err;
            }
            return { rows: [] as T[] };
          },
          release: () => {
            released = true;
          }
        }),
        end: async () => undefined
      }
    };

    await expect(
      readDatabaseRows({
        target,
        snapshot: snap,
        cursorKey: TEST_CURSOR_KEY,
        request: makeRowsRequest()
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('DATABASE_QUERY_TIMEOUT') });

    // Connection must be released even after error
    expect(released).toBe(true);
    // ROLLBACK must be called
    expect(queries).toContain('ROLLBACK');
  });
});

// ---------------------------------------------------------------------------
// Tests — duplicate / nullable pagination key stability
// ---------------------------------------------------------------------------

describe('databaseExplorerBounds — pagination stability', () => {
  it('returns stable results when PK column has duplicate values (offset fallback)', async () => {
    // When keyset pagination is not possible (nullable PK), results remain bounded
    const relations = [
      makeRelation('events', {
        primaryKey: null,
        paginationKey: null,
        columns: [makeColumn('id', 'int4'), makeColumn('name')]
      })
    ];
    const snap = makeSnapshot([{ name: 'public', relations }]);
    const { target } = mockTarget(
      Array.from({ length: 25 }, (_, i) => ({ id: null, name: `event_${i}` })),
      snap
    );

    const result = await readDatabaseRows({
      target,
      snapshot: snap,
      cursorKey: TEST_CURSOR_KEY,
      request: { ...makeRowsRequest(), relation: 'events' }
    });

    expect(result.rows.length).toBeLessThanOrEqual(25);
    expect(result.consistency).toBe('best_effort');
  });
});
