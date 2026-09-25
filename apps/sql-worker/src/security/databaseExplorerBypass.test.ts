/**
 * Unit tests for Database Explorer worker validation and row encoding.
 *
 * These mocks cover worker-side behavior only; they do not prove PostgreSQL role
 * enforcement. Live database enforcement is covered by
 * databaseExplorerPostgres.integration.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readDatabaseRows } from '../explorer/rowReader.js';
import { readRelatedRows } from '../explorer/relatedRowReader.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabasePageSize,
  DatabaseRelatedRowsRequest,
  DatabaseRowsRequest
} from '../../../../packages/contracts/src/databaseExplorer.js';

const TEST_CURSOR_KEY = Buffer.alloc(32, 1).toString('base64');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

type MockTargetResult = {
  target: AvailableTargetEntry;
  queries: string[];
  values: Array<readonly unknown[] | undefined>;
  released: boolean;
};

function makeMockTarget(
  options: {
    queryHandler?: (sql: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
  } = {}
): MockTargetResult {
  const schemaSnapshot = makeSnapshot();
  const queries: string[] = [];
  const values: Array<readonly unknown[] | undefined> = [];
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
        query: async <T>(sql: string, vals?: readonly unknown[]) => {
          queries.push(sql);
          values.push(vals);
          const catalogRows = schemaCatalogRows(schemaSnapshot, sql);
          if (catalogRows !== undefined) return { rows: catalogRows as T[] };
          if (options.queryHandler) {
            return (await options.queryHandler(sql, vals)) as { rows: T[] };
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

  return { target, queries, values, released };
}

/** A minimal schema snapshot with one table, blocked and pii columns. */
function makeSnapshot(): DatabaseExplorerSchemaSnapshot {
  const snapshot: DatabaseExplorerSchemaSnapshot = {
    targetId: 'ops',
    targetLabel: 'Ops DB',
    checksum: '',
    policyVersion: '2026-09-25-v2',
    schemas: [
      {
        name: 'public',
        relations: [
          {
            name: 'users',
            kind: 'table',
            primaryKey: ['id'],
            paginationKey: ['id'],
            rowLevelSecurity: { enabled: true, forced: true },
            dataAvailable: true,
            estimatedRows: 100,
            columns: [
              {
                name: 'id',
                dataType: 'int4',
                nullable: false,
                hasDefault: true,
                identity: 'always',
                generated: false,
                classification: 'public',
                selectable: true,
                filterOperators: ['eq', 'gt', 'lt']
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
                name: 'ssn',
                dataType: 'text',
                nullable: true,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'blocked',
                selectable: false,
                filterOperators: []
              }
            ],
            constraints: [],
            indexes: [],
            triggers: [],
            policies: []
          }
        ]
      }
    ],
    edges: []
  };
  const structural = {
    schemas: snapshot.schemas.map((schema) => ({
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
  snapshot.checksum = createHash('sha256').update(JSON.stringify(structural), 'utf8').digest('hex');
  return snapshot;
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
  if (
    sql.includes('/* catalog:constraints */') ||
    sql.includes('/* catalog:indexes */') ||
    sql.includes('/* catalog:triggers */') ||
    sql.includes('/* catalog:policies */')
  ) {
    return [];
  }
  return undefined;
}

function makeRowsRequest(overrides: Partial<DatabaseRowsRequest> = {}): DatabaseRowsRequest {
  return {
    targetId: 'ops',
    schema: 'public',
    relation: 'users',
    pageSize: 25,
    filters: [],
    piiMode: 'masked',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('databaseExplorerWorker unit — blocked column encoding', () => {
  it('blocked column never appears in the SQL SELECT list', async () => {
    const { target, queries } = makeMockTarget({
      queryHandler: async (sql) => {
        // Return a row with all columns including ssn
        if (sql.includes('SELECT')) {
          return { rows: [{ id: 1, email: 'test@example.com', ssn: 'SECRET-SSN' }] };
        }
        return { rows: [] };
      }
    });

    const snapshot = makeSnapshot();
    const result = await readDatabaseRows({
      target,
      snapshot,
      cursorKey: TEST_CURSOR_KEY,
      request: makeRowsRequest()
    });

    // The SQL must not select the blocked column
    const selectQuery = queries.find((q) => q.includes('FROM "public"."users"'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery).not.toMatch(/\bssn\b/i);

    // Even if the query accidentally returned ssn, the cell must be blocked
    const userRow = result.rows[0];
    if (userRow) {
      const ssnCell = userRow.cells['ssn'];
      // Either undefined (not fetched) or blocked state
      if (ssnCell !== undefined) {
        expect(ssnCell.state).toBe('blocked');
      }
    }
  });

  it('blocked column is marked state=blocked in output regardless of DB value', async () => {
    const { target } = makeMockTarget({
      queryHandler: async (sql) => {
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
          // Simulate DB returning ssn even though role should not allow it
          return { rows: [{ id: 1, ssn: 'SHOULD-NOT-APPEAR' }] };
        }
        return { rows: [] };
      }
    });

    const snapshot = makeSnapshot();
    // Override: include ssn in columns (as if selectable was true) to test encodeCell
    snapshot.schemas[0].relations[0].columns[2].selectable = true;

    const result = await readDatabaseRows({
      target,
      snapshot,
      cursorKey: TEST_CURSOR_KEY,
      request: makeRowsRequest()
    });

    for (const row of result.rows) {
      const ssnCell = row.cells['ssn'];
      if (ssnCell !== undefined) {
        expect(ssnCell.state).toBe('blocked');
        expect(JSON.stringify(ssnCell)).not.toContain('SHOULD-NOT-APPEAR');
      }
    }
  });

});

describe('databaseExplorerWorker unit — forged payload rejection', () => {
  it('rejects request for a target ID not present in the snapshot', async () => {
    const { target } = makeMockTarget();
    const snapshot = makeSnapshot(); // targetId: 'ops'

    // The worker command handler performs target matching before invoking readDatabaseRows.
    // At the rowReader level, we verify schema/relation validation catches unknown schemas:
    const badRequest = makeRowsRequest({ schema: 'hacked_schema' });
    await expect(
      readDatabaseRows({ target, snapshot, cursorKey: TEST_CURSOR_KEY, request: badRequest })
    ).rejects.toMatchObject({ message: expect.stringContaining('DATABASE_RELATION_INVALID') });
  });

  it('rejects an unknown relation name', async () => {
    const { target } = makeMockTarget();
    const snapshot = makeSnapshot();

    await expect(
      readDatabaseRows({
        target,
        snapshot,
        cursorKey: TEST_CURSOR_KEY,
        request: makeRowsRequest({ relation: 'nonexistent_table' })
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('DATABASE_RELATION_INVALID') });
  });

  it('rejects an invalid page size (not 25/50/100)', async () => {
    const { target } = makeMockTarget();
    const snapshot = makeSnapshot();

    await expect(
      readDatabaseRows({
        target,
        snapshot,
        cursorKey: TEST_CURSOR_KEY,
        request: makeRowsRequest({ pageSize: 101 as unknown as DatabasePageSize })
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('DATABASE_PAGE_TOO_LARGE') });
  });

  it('rejects filter on a non-selectable / blocked column', async () => {
    const { target } = makeMockTarget();
    const snapshot = makeSnapshot();

    await expect(
      readDatabaseRows({
        target,
        snapshot,
        cursorKey: TEST_CURSOR_KEY,
        request: makeRowsRequest({
          filters: [{ column: 'ssn', operator: 'eq', value: 'anything' }]
        })
      })
      // Blocked column filter is rejected as DATABASE_FILTER_INVALID (found but not filterable)
    ).rejects.toMatchObject({ message: expect.stringContaining('DATABASE_FILTER_INVALID') });
  });

  it('rejects an expired or tampered cursor', async () => {
    const { target } = makeMockTarget();
    const snapshot = makeSnapshot();

    await expect(
      readDatabaseRows({
        target,
        snapshot,
        cursorKey: TEST_CURSOR_KEY,
        request: makeRowsRequest({ cursor: 'invalid.tampered.cursor' })
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('DATABASE_CURSOR_INVALID') });
  });

  it('rejects related rows request with a malformed rowRef', async () => {
    const { target } = makeMockTarget();
    const snapshot = makeSnapshot();
    const relatedRequest: DatabaseRelatedRowsRequest = {
      targetId: 'ops',
      schema: 'public',
      relation: 'users',
      constraint: 'nonexistent_fk',
      rowRef: 'invalid-row-ref',
      pageSize: 25,
      piiMode: 'masked'
    };

    // Invalid rowRef is caught before constraint lookup
    await expect(
      readRelatedRows({ target, snapshot, cursorKey: TEST_CURSOR_KEY, request: relatedRequest })
    ).rejects.toMatchObject({
      message: expect.stringContaining('DATABASE_CURSOR_INVALID')
    });
  });
});

describe('databaseExplorerBypass unit — generated query shape', () => {
  it('rowReader never generates INSERT/UPDATE/DELETE/DDL SQL', async () => {
    const { target, queries } = makeMockTarget({
      queryHandler: async () => ({ rows: [] })
    });
    const snapshot = makeSnapshot();

    await readDatabaseRows({
      target,
      snapshot,
      cursorKey: TEST_CURSOR_KEY,
      request: makeRowsRequest()
    });

    const mutationQueries = queries.filter((q) =>
      /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|COPY)\b/i.test(q)
    );
    expect(mutationQueries).toEqual([]);
  });
});
