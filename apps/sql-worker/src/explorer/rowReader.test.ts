import { describe, expect, it } from 'vitest';
import { readDatabaseRows } from './rowReader.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRowsRequest
} from '../../../../packages/contracts/src/databaseExplorer.js';

function createMockTarget(options: {
  queryHandler?: (
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  throwTimeout?: boolean;
}): { target: AvailableTargetEntry; queries: string[]; rolledBack: boolean; released: boolean } {
  const queries: string[] = [];
  let rolledBack = false;
  let released = false;

  const target: AvailableTargetEntry = {
    id: 'edutrack_production',
    label: 'EduTrack Production',
    status: 'available',
    databaseName: 'edutrack_prod',
    role: 'ops_database_browser',
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async <T>(sql: string, values?: readonly unknown[]) => {
          queries.push(sql);
          if (sql === 'ROLLBACK') {
            rolledBack = true;
            return { rows: [] as T[] };
          }
          if (options.throwTimeout && sql.startsWith('SELECT')) {
            const err = Object.assign(new Error('canceling statement due to statement timeout'), {
              code: '57014'
            });
            throw err;
          }
          if (options.queryHandler) {
            return (await options.queryHandler(sql, values)) as { rows: T[] };
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

  return {
    target,
    queries,
    get rolledBack() {
      return rolledBack;
    },
    get released() {
      return released;
    }
  };
}

function createSnapshotFixture(): DatabaseExplorerSchemaSnapshot {
  return {
    targetId: 'edutrack_production',
    targetLabel: 'EduTrack Production',
    checksum: 'mock_checksum_123',
    policyVersion: '2026-09-25',
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
            estimatedRows: 50,
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
                filterOperators: ['eq', 'neq']
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
                filterOperators: ['eq', 'neq', 'contains']
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
            name: 'unbrowseable_table',
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
                name: 'raw_data',
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
}

describe('readDatabaseRows', () => {
  const cursorKey = '01234567890123456789012345678901';

  it('executes read transaction with read-only, timeouts, fetches rows, and rolls back', async () => {
    const rows = [
      { id: '1', email: 'alice@example.com' },
      { id: '2', email: 'bob@example.com' }
    ];

    const mock = createMockTarget({
      queryHandler: async (sql) => {
        if (sql.startsWith('SELECT')) {
          return { rows };
        }
        return { rows: [] };
      }
    });

    const snapshot = createSnapshotFixture();
    const request: DatabaseRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [],
      piiMode: 'masked'
    };

    const response = await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request
    });

    expect(mock.queries).toContain('BEGIN READ ONLY');
    expect(mock.queries).toContain("SET LOCAL statement_timeout = '15s'");
    expect(mock.queries).toContain("SET LOCAL lock_timeout = '2s'");
    expect(mock.rolledBack).toBe(true);
    expect(mock.released).toBe(true);

    expect(response.rows).toHaveLength(2);
    expect(response.rows[0].cells.id).toEqual({ state: 'value', value: '1' });
    expect(response.rows[0].cells.email).toEqual({ state: 'masked', display: 'a***@example.com' });
    expect(response.rows[0].cells.password_hash).toEqual({ state: 'blocked' });
    expect(response.rows[0].rowRef).toBeDefined();
    expect(response.nextCursor).toBeNull();
    expect(response.consistency).toBe('stable');
  });

  it('reveals PII values when piiMode is revealed', async () => {
    const mock = createMockTarget({
      queryHandler: async (sql) => {
        if (sql.startsWith('SELECT')) {
          return { rows: [{ id: '1', email: 'alice@example.com' }] };
        }
        return { rows: [] };
      }
    });

    const snapshot = createSnapshotFixture();
    const request: DatabaseRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [],
      piiMode: 'revealed'
    };

    const response = await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request
    });

    expect(response.rows[0].cells.email).toEqual({ state: 'value', value: 'alice@example.com' });
    expect(response.rows[0].cells.password_hash).toEqual({ state: 'blocked' });
  });

  it('returns nextCursor when rows returned exceed pageSize', async () => {
    // 26 rows returned when pageSize is 25
    const rows = Array.from({ length: 26 }, (_, i) => ({
      id: `id_${i + 1}`,
      email: `user${i + 1}@example.com`
    }));

    const mock = createMockTarget({
      queryHandler: async (sql) => {
        if (sql.startsWith('SELECT')) {
          return { rows };
        }
        return { rows: [] };
      }
    });

    const snapshot = createSnapshotFixture();
    const request: DatabaseRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [],
      piiMode: 'masked'
    };

    const response = await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request
    });

    expect(response.rows).toHaveLength(25);
    expect(response.nextCursor).toBeDefined();
    expect(typeof response.nextCursor).toBe('string');
  });

  it('maps statement timeout to DATABASE_QUERY_TIMEOUT and still rolls back', async () => {
    const mock = createMockTarget({ throwTimeout: true });
    const snapshot = createSnapshotFixture();
    const request: DatabaseRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [],
      piiMode: 'masked'
    };

    await expect(
      readDatabaseRows({
        target: mock.target,
        snapshot,
        cursorKey,
        request
      })
    ).rejects.toThrowError(/DATABASE_QUERY_TIMEOUT/);

    expect(mock.rolledBack).toBe(true);
    expect(mock.released).toBe(true);
  });

  it('rejects data browsing on unbrowseable tables with DATABASE_DATA_PERMISSION_DENIED', async () => {
    const mock = createMockTarget();
    const snapshot = createSnapshotFixture();
    const request: DatabaseRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'unbrowseable_table',
      pageSize: 25,
      filters: [],
      piiMode: 'masked'
    };

    await expect(
      readDatabaseRows({
        target: mock.target,
        snapshot,
        cursorKey,
        request
      })
    ).rejects.toThrowError(/DATABASE_DATA_PERMISSION_DENIED/);
  });
});
