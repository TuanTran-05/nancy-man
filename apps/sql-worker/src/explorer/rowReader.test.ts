import { describe, expect, it } from 'vitest';
import { readDatabaseRows } from './rowReader.js';
import { decodeCursor, decodeRowRef } from './cursorCodec.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRowsRequest
} from '../../../../packages/contracts/src/databaseExplorer.js';
import { readProductionSchema } from '../schema/introspectSchema.js';
import { installOpsRuntimeTelemetry } from '../telemetry/runtimeTelemetry.js';

function createMockTarget(
  options: {
    queryHandler?: (
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: Record<string, unknown>[] }>;
    throwTimeout?: boolean;
    drift?: { enabled: boolean };
    afterConnectionRelease?: (connectionIndex: number) => void;
  } = {}
): {
  target: AvailableTargetEntry;
  queries: string[];
  connectionQueries: string[][];
  rolledBack: boolean;
  released: boolean;
} {
  const queries: string[] = [];
  const connectionQueries: string[][] = [];
  let rolledBack = false;
  let released = false;
  let connectionCount = 0;

  const target: AvailableTargetEntry = {
    id: 'edutrack_production',
    label: 'EduTrack Production',
    status: 'available',
    databaseName: 'edutrack_prod',
    role: 'ops_database_browser',
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => {
        const connectionIndex = ++connectionCount;
        const connectionQueriesForCall: string[] = [];
        connectionQueries.push(connectionQueriesForCall);
        return {
          query: async <T>(sql: string, values?: readonly unknown[]) => {
            queries.push(sql);
            connectionQueriesForCall.push(sql);
            if (sql === 'ROLLBACK') {
              rolledBack = true;
              return { rows: [] as T[] };
            }
            if (sql.includes('catalog:schemas')) {
              return { rows: [{ schemaName: 'public' }] as T[] };
            }
            if (sql.includes('catalog:relations')) {
              return {
                rows: [
                  {
                    schemaName: 'public',
                    relationName: 'students',
                    kind: 'table',
                    rowSecurityEnabled: false,
                    forceRowSecurity: false
                  },
                  {
                    schemaName: 'public',
                    relationName: 'unbrowseable_table',
                    kind: 'foreign_table',
                    rowSecurityEnabled: false,
                    forceRowSecurity: false
                  }
                ] as T[]
              };
            }
            if (sql.includes('catalog:columns')) {
              return {
                rows: [
                  {
                    schemaName: 'public',
                    relationName: 'students',
                    columnName: 'id',
                    dataType: 'uuid',
                    nullable: false,
                    hasDefault: true,
                    identity: '',
                    generated: ''
                  },
                  {
                    schemaName: 'public',
                    relationName: 'students',
                    columnName: 'email',
                    dataType: 'text',
                    nullable: false,
                    hasDefault: false,
                    identity: '',
                    generated: ''
                  },
                  {
                    schemaName: 'public',
                    relationName: 'students',
                    columnName: 'password_hash',
                    dataType: 'text',
                    nullable: false,
                    hasDefault: false,
                    identity: '',
                    generated: ''
                  },
                  {
                    schemaName: 'public',
                    relationName: 'unbrowseable_table',
                    columnName: 'raw_data',
                    dataType: 'text',
                    nullable: true,
                    hasDefault: false,
                    identity: '',
                    generated: ''
                  },
                  ...(options.drift?.enabled
                    ? [
                        {
                          schemaName: 'public',
                          relationName: 'students',
                          columnName: 'new_column',
                          dataType: 'text',
                          nullable: true,
                          hasDefault: false,
                          identity: '',
                          generated: ''
                        }
                      ]
                    : [])
                ] as T[]
              };
            }
            if (sql.includes('catalog:constraints')) {
              return {
                rows: [
                  {
                    schemaName: 'public',
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
            if (
              sql.includes('catalog:indexes') ||
              sql.includes('catalog:triggers') ||
              sql.includes('catalog:policies')
            ) {
              return { rows: [] as T[] };
            }
            const isRowSelect =
              sql.startsWith('SELECT') && sql.includes('FROM "public"."students"');
            if (options.throwTimeout && isRowSelect) {
              const err = Object.assign(new Error('canceling statement due to statement timeout'), {
                code: '57014'
              });
              throw err;
            }
            if (options.queryHandler && isRowSelect) {
              return (await options.queryHandler(sql, values)) as { rows: T[] };
            }
            return { rows: [] as T[] };
          },
          release: () => {
            released = true;
            options.afterConnectionRelease?.(connectionIndex);
          }
        };
      },
      end: async () => undefined
    }
  };

  return {
    target,
    queries,
    connectionQueries,
    get rolledBack() {
      return rolledBack;
    },
    get released() {
      return released;
    }
  };
}

function createSnapshotFixture(checksum = 'mock_checksum_123'): DatabaseExplorerSchemaSnapshot {
  return {
    targetId: 'edutrack_production',
    targetLabel: 'EduTrack Production',
    checksum,
    policyVersion: '2026-09-25-v2',
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

async function createSnapshotForTarget(
  target: AvailableTargetEntry
): Promise<DatabaseExplorerSchemaSnapshot> {
  const connection = await target.pool.connect();
  try {
    const structural = await readProductionSchema({ database: connection });
    return createSnapshotFixture(structural.checksum);
  } finally {
    connection.release();
  }
}

describe('readDatabaseRows', () => {
  const cursorKey = Buffer.alloc(32, 11).toString('base64');

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

    const snapshot = await createSnapshotForTarget(mock.target);
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

    expect(mock.queries).toContain('BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ');
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

  it('encrypts selectable source FK values into rowRefs without including blocked values', async () => {
    const sourceValue = 'student@example.test';
    const blockedValue = 'super-secret-hash';
    const mock = createMockTarget({
      queryHandler: async () => ({
        rows: [{ id: 'student-1', email: sourceValue, password_hash: blockedValue }]
      })
    });
    const snapshot = await createSnapshotForTarget(mock.target);
    snapshot.edges = [
      {
        constraint: 'students_email_fkey',
        from: { schema: 'public', relation: 'students', columns: ['email'] },
        to: { schema: 'public', relation: 'accounts', columns: ['email'] }
      },
      {
        constraint: 'students_password_fkey',
        from: { schema: 'public', relation: 'students', columns: ['password_hash'] },
        to: { schema: 'public', relation: 'accounts', columns: ['password_hash'] }
      }
    ];

    const response = await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request: {
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      }
    });

    const rowRef = response.rows[0]?.rowRef;
    expect(rowRef).toBeTruthy();
    expect(rowRef).not.toContain(sourceValue);
    expect(rowRef).not.toContain('s***@example.test');
    expect(rowRef).not.toContain(blockedValue);
    expect(
      mock.queries.find(
        (sql) => sql.startsWith('SELECT') && sql.includes('FROM "public"."students"')
      )
    ).not.toContain('"password_hash"');
    expect(
      decodeRowRef({
        encodedRowRef: rowRef!,
        key: cursorKey,
        expected: {
          targetId: 'edutrack_production',
          schema: 'public',
          relation: 'students',
          checksum: snapshot.checksum
        }
      }).keys
    ).toEqual({ id: 'student-1', email: sourceValue });
  });

  it('returns rows with null rowRefs when many or large FK claims exceed the token limit', async () => {
    const claimColumns = Array.from({ length: 40 }, (_, index) => `email_fk_${index}`);
    const manyClaims = Object.fromEntries(
      claimColumns.map((column, index) => [
        column,
        `many-marker-${index}-${'m'.repeat(130)}@example.test`
      ])
    );
    const largeClaim = {
      [claimColumns[0]!]: `large-marker-${'l'.repeat(5000)}@example.test`
    };
    const normalClaims = Object.fromEntries(
      claimColumns.map((column, index) => [column, `normal-${index}@example.test`])
    );
    const returnedRows = [
      { id: 'many-claims', email: 'many@example.test', ...manyClaims },
      { id: 'large-claim', email: 'large@example.test', ...largeClaim },
      { id: 'normal-claims', email: 'normal@example.test', ...normalClaims }
    ];
    const mock = createMockTarget({ queryHandler: async () => ({ rows: returnedRows }) });
    const snapshot = await createSnapshotForTarget(mock.target);
    const students = snapshot.schemas[0]?.relations.find(
      (relation) => relation.name === 'students'
    );
    students?.columns.push(
      ...claimColumns.map((name) => ({
        name,
        dataType: 'text',
        nullable: true,
        hasDefault: false,
        identity: null,
        generated: false,
        classification: 'pii' as const,
        selectable: true,
        filterOperators: ['eq' as const]
      }))
    );
    snapshot.edges = claimColumns.map((column, index) => ({
      constraint: `students_email_fk_${index}`,
      from: { schema: 'public', relation: 'students', columns: [column] },
      to: { schema: 'public', relation: `accounts_${index}`, columns: [`email_${index}`] }
    }));

    const response = await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request: {
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      }
    });

    expect(response.rows).toHaveLength(3);
    expect(response.truncated).toBe(false);
    expect(response.rows.map((row) => row.cells.id)).toEqual([
      { state: 'value', value: 'many-claims' },
      { state: 'value', value: 'large-claim' },
      { state: 'value', value: 'normal-claims' }
    ]);
    expect(response.rows[0]?.rowRef).toBeNull();
    expect(response.rows[1]?.rowRef).toBeNull();
    expect(response.rows[2]?.rowRef).toBeTruthy();
    expect(response.rows[0]?.cells[claimColumns[0]!]?.state).toBe('masked');
    expect(response.rows[1]?.cells[claimColumns[0]!]?.state).toBe('masked');
    expect(JSON.stringify(response)).not.toContain('many-marker-');
    expect(JSON.stringify(response)).not.toContain('large-marker-');
  });

  it('keeps the page when structured FK claims cannot be bounded without serialization', async () => {
    let objectToJsonCalls = 0;
    let arrayToJsonCalls = 0;
    const objectClaim = {
      toJSON() {
        objectToJsonCalls++;
        return { marker: 'structured-object-marker', payload: 'o'.repeat(5000) };
      }
    };
    const arrayClaim = Object.assign(['structured-array-marker'], {
      toJSON() {
        arrayToJsonCalls++;
        return ['structured-array-marker', 'a'.repeat(5000)];
      }
    });
    const claimColumns = ['email_fk_object', 'email_fk_array'];
    const mock = createMockTarget({
      queryHandler: async () => ({
        rows: [
          { id: 'object-claim', email: 'object@example.test', [claimColumns[0]!]: objectClaim },
          { id: 'array-claim', email: 'array@example.test', [claimColumns[1]!]: arrayClaim },
          {
            id: 'normal-claim',
            email: 'normal@example.test',
            [claimColumns[0]!]: 'normal-object@example.test',
            [claimColumns[1]!]: 'normal-array@example.test'
          }
        ]
      })
    });
    const snapshot = await createSnapshotForTarget(mock.target);
    const students = snapshot.schemas[0]?.relations.find(
      (relation) => relation.name === 'students'
    );
    students?.columns.push(
      ...claimColumns.map((name) => ({
        name,
        dataType: 'text',
        nullable: true,
        hasDefault: false,
        identity: null,
        generated: false,
        classification: 'pii' as const,
        selectable: true,
        filterOperators: ['eq' as const]
      }))
    );
    snapshot.edges = claimColumns.map((column, index) => ({
      constraint: `students_structured_fk_${index}`,
      from: { schema: 'public', relation: 'students', columns: [column] },
      to: { schema: 'public', relation: `accounts_${index}`, columns: [`email_${index}`] }
    }));

    const response = await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request: {
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      }
    });

    expect(response.rows).toHaveLength(3);
    expect(response.truncated).toBe(false);
    expect(response.rows.map((row) => row.cells.id)).toEqual([
      { state: 'value', value: 'object-claim' },
      { state: 'value', value: 'array-claim' },
      { state: 'value', value: 'normal-claim' }
    ]);
    expect(response.rows[0]?.rowRef).toBeNull();
    expect(response.rows[1]?.rowRef).toBeNull();
    expect(response.rows[2]?.rowRef).toBeTruthy();
    expect(response.rows[0]?.cells[claimColumns[0]!]).toEqual({
      state: 'masked',
      display: '••••••'
    });
    expect(response.rows[1]?.cells[claimColumns[1]!]).toEqual({
      state: 'masked',
      display: '••••••'
    });
    expect(objectToJsonCalls).toBe(0);
    expect(arrayToJsonCalls).toBe(0);
    expect(JSON.stringify(response)).not.toContain('structured-object-marker');
    expect(JSON.stringify(response)).not.toContain('structured-array-marker');
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

    const snapshot = await createSnapshotForTarget(mock.target);
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

    const snapshot = await createSnapshotForTarget(mock.target);
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

  it('keeps the freshness check and row SELECT in one repeatable-read transaction', async () => {
    const drift = { enabled: false };
    let rowSelectCount = 0;
    const mock = createMockTarget({
      drift,
      afterConnectionRelease: (connectionIndex) => {
        if (connectionIndex === 2) drift.enabled = true;
      },
      queryHandler: async () => {
        rowSelectCount++;
        return { rows: [{ id: '1', email: 'alice@example.com' }] };
      }
    });
    const snapshot = await createSnapshotForTarget(mock.target);
    mock.queries.length = 0;
    mock.connectionQueries.length = 0;

    await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request: {
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      }
    });

    expect(mock.connectionQueries).toHaveLength(1);
    const transactionQueries = mock.connectionQueries[0]!;
    expect(transactionQueries[0]).toBe(
      'BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ'
    );
    const checksumIndex = transactionQueries.findIndex((sql) =>
      sql.includes('/* catalog:schemas */')
    );
    const rowSelectIndex = transactionQueries.findIndex(
      (sql) => sql.startsWith('SELECT') && sql.includes('FROM "public"."students"')
    );
    expect(checksumIndex).toBeGreaterThan(0);
    expect(rowSelectIndex).toBeGreaterThan(checksumIndex);
    expect(transactionQueries.at(-1)).toBe('ROLLBACK');
    expect(rowSelectCount).toBe(1);
  });

  it('rejects schema drift before issuing the row SELECT', async () => {
    const drift = { enabled: false };
    let rowSelectCount = 0;
    const mock = createMockTarget({
      drift,
      queryHandler: async () => {
        rowSelectCount++;
        return { rows: [{ id: '1', email: 'alice@example.com' }] };
      }
    });
    const snapshot = await createSnapshotForTarget(mock.target);
    drift.enabled = true;

    await expect(
      readDatabaseRows({
        target: mock.target,
        snapshot,
        cursorKey,
        request: {
          targetId: 'edutrack_production',
          schema: 'public',
          relation: 'students',
          pageSize: 25,
          filters: [],
          piiMode: 'masked'
        }
      })
    ).rejects.toThrowError('DATABASE_SCHEMA_STALE');

    expect(rowSelectCount).toBe(0);
    expect(
      mock.queries.some(
        (sql) => sql.startsWith('SELECT') && sql.includes('FROM "public"."students"')
      )
    ).toBe(false);
  });

  it('rejects cursor continuation after the requested sort changes', async () => {
    let rowSelectCount = 0;
    const mock = createMockTarget({
      queryHandler: async () => {
        rowSelectCount++;
        return {
          rows: Array.from({ length: 26 }, (_, index) => ({
            id: `id_${index + 1}`,
            email: `user${index + 1}@example.com`
          }))
        };
      }
    });
    const snapshot = await createSnapshotForTarget(mock.target);
    const firstPage = await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request: {
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        sort: { column: 'email', direction: 'asc' },
        filters: [],
        piiMode: 'masked'
      }
    });

    await expect(
      readDatabaseRows({
        target: mock.target,
        snapshot,
        cursorKey,
        request: {
          targetId: 'edutrack_production',
          schema: 'public',
          relation: 'students',
          pageSize: 25,
          cursor: firstPage.nextCursor!,
          sort: { column: 'email', direction: 'desc' },
          filters: [],
          piiMode: 'masked'
        }
      })
    ).rejects.toThrowError('DATABASE_CURSOR_INVALID');
    expect(rowSelectCount).toBe(1);
  });

  it('keeps cursor values out of database errors and telemetry', async () => {
    const marker = 'sort-claim-sensitive-marker';
    let rowSelectCount = 0;
    const mock = createMockTarget({
      queryHandler: async () => {
        rowSelectCount++;
        if (rowSelectCount > 1) throw new Error(`invalid sort value ${marker}`);
        return {
          rows: Array.from({ length: 26 }, (_, index) => ({
            id: `id_${index + 1}`,
            email: `user${index + 1}@example.com`
          }))
        };
      }
    });
    const snapshot = await createSnapshotForTarget(mock.target);
    const firstPage = await readDatabaseRows({
      target: mock.target,
      snapshot,
      cursorKey,
      request: {
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        sort: { column: 'email', direction: 'asc' },
        filters: [],
        piiMode: 'masked'
      }
    });
    const captured: Array<{ message: string; code: string }> = [];
    const uninstall = installOpsRuntimeTelemetry({
      captureException: (error, context) => {
        captured.push({
          message: error instanceof Error ? error.message : String(error),
          code: context.code
        });
        return 'EVT_00000000000000000000000000';
      },
      flush: async () => undefined,
      healthy: () => true
    });

    try {
      await expect(
        readDatabaseRows({
          target: mock.target,
          snapshot,
          cursorKey,
          request: {
            targetId: 'edutrack_production',
            schema: 'public',
            relation: 'students',
            pageSize: 25,
            cursor: firstPage.nextCursor!,
            sort: { column: 'email', direction: 'asc' },
            filters: [],
            piiMode: 'masked'
          }
        })
      ).rejects.toThrowError('DATABASE_QUERY_FAILED');
    } finally {
      uninstall();
    }

    expect(captured).toEqual([{ message: 'DATABASE_QUERY_FAILED', code: 'DATABASE_QUERY_FAILED' }]);
    expect(JSON.stringify(captured)).not.toContain(marker);
  });

  it.each(['asc', 'desc'] as const)(
    'pages duplicate and nullable sort values once in %s order with a composite stable key',
    async (direction) => {
      const data = Array.from({ length: 56 }, (_, index) => ({
        id: `id_${String(index + 1).padStart(2, '0')}`,
        tenant_id: `tenant_${String((index % 3) + 1)}`,
        sort_value: index < 8 ? 'alpha' : index < 17 ? 'beta' : index < 26 ? 'gamma' : null
      }));
      const compareText = (left: string, right: string): number => left.localeCompare(right);
      const compareRows = (
        left: Record<string, unknown>,
        right: Record<string, unknown>
      ): number => {
        const leftSort = left.sort_value as string | null;
        const rightSort = right.sort_value as string | null;
        let compared =
          leftSort === null
            ? rightSort === null
              ? 0
              : 1
            : rightSort === null
              ? -1
              : compareText(leftSort, rightSort) * (direction === 'desc' ? -1 : 1);
        if (compared !== 0) return compared;
        compared = compareText(left.tenant_id as string, right.tenant_id as string);
        if (compared !== 0) return compared * (direction === 'desc' ? -1 : 1);
        return compareText(left.id as string, right.id as string) * (direction === 'desc' ? -1 : 1);
      };
      const ordered = [...data].sort(compareRows);
      let currentCursor: string | undefined;
      let nowCalls = 0;
      const now = () => new Date(Date.now() + nowCalls++ * 10);
      const dataQueries: Array<{ sql: string; values: readonly unknown[] }> = [];
      const mock = createMockTarget({
        queryHandler: async (sql, values) => {
          dataQueries.push({ sql, values: values ?? [] });
          const after = currentCursor
            ? decodeCursor({
                encodedCursor: currentCursor,
                key: cursorKey,
                expected: {
                  targetId: 'edutrack_production',
                  schema: 'public',
                  relation: 'students',
                  checksum: snapshot.checksum
                }
              })
            : undefined;
          const afterValues =
            after?.kind === 'keyset'
              ? Object.fromEntries(after.keys.map((key) => [key.column, key.value]))
              : undefined;
          const remaining = afterValues
            ? ordered.filter(
                (row) =>
                  compareRows(row, {
                    sort_value: afterValues.sort_value,
                    tenant_id: afterValues.tenant_id,
                    id: afterValues.id
                  }) > 0
              )
            : ordered;
          return { rows: remaining.slice(0, 26) };
        }
      });
      const snapshot = await createSnapshotForTarget(mock.target);
      const relation = snapshot.schemas[0]?.relations[0];
      if (!relation) throw new Error('student relation fixture missing');
      relation.paginationKey = ['tenant_id', 'id'];
      relation.columns.push(
        {
          name: 'tenant_id',
          dataType: 'text',
          nullable: false,
          hasDefault: false,
          identity: null,
          generated: false,
          classification: 'internal',
          selectable: true,
          filterOperators: ['eq', 'neq', 'contains', 'is_null', 'is_not_null']
        },
        {
          name: 'sort_value',
          dataType: 'text',
          nullable: true,
          hasDefault: false,
          identity: null,
          generated: false,
          classification: 'internal',
          selectable: true,
          filterOperators: ['eq', 'neq', 'contains', 'is_null', 'is_not_null']
        }
      );

      const seenIds: string[] = [];
      let cursor: string | undefined;
      do {
        currentCursor = cursor;
        const response = await readDatabaseRows({
          target: mock.target,
          snapshot,
          cursorKey,
          now,
          request: {
            targetId: 'edutrack_production',
            schema: 'public',
            relation: 'students',
            pageSize: 25,
            ...(cursor ? { cursor } : {}),
            sort: { column: 'sort_value', direction },
            filters: [],
            piiMode: 'masked'
          }
        });
        seenIds.push(
          ...response.rows.map((row) =>
            String(row.cells.id?.state === 'value' ? row.cells.id.value : '')
          )
        );
        cursor = response.nextCursor ?? undefined;
      } while (cursor);

      expect(seenIds).toEqual(ordered.map((row) => row.id));
      expect(new Set(seenIds).size).toBe(data.length);
      expect(dataQueries[0]?.sql).toContain(
        '"sort_value" ' + direction.toUpperCase() + ' NULLS LAST'
      );
      expect(dataQueries[0]?.sql).toContain(
        '"tenant_id" ' + direction.toUpperCase() + ' NULLS LAST'
      );
      expect(dataQueries[0]?.sql).toContain('"id" ' + direction.toUpperCase() + ' NULLS LAST');
      expect(dataQueries[1]?.sql).toContain(
        `"sort_value" ${direction === 'desc' ? '<' : '>'} $1 OR "sort_value" IS NULL`
      );
      expect(dataQueries[2]?.sql).toContain('"sort_value" IS NULL');
      expect(dataQueries[2]?.sql).toContain(`"tenant_id" ${direction === 'desc' ? '<' : '>'}`);
    }
  );

  it('maps statement timeout to DATABASE_QUERY_TIMEOUT and still rolls back', async () => {
    const mock = createMockTarget({ throwTimeout: true });
    const snapshot = await createSnapshotForTarget(mock.target);
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
    const snapshot = await createSnapshotForTarget(mock.target);
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
