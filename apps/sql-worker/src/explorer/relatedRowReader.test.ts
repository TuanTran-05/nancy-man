import { describe, expect, it } from 'vitest';
import { readRelatedRows } from './relatedRowReader.js';
import { encodeRowRef } from './cursorCodec.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRelatedRowsRequest
} from '../../../../packages/contracts/src/databaseExplorer.js';

function createMockTarget(options: {
  queryHandler?: (
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}): AvailableTargetEntry {
  return {
    id: 'edutrack_production',
    label: 'EduTrack Production',
    status: 'available',
    databaseName: 'edutrack_prod',
    role: 'ops_database_browser',
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async <T>(sql: string, values?: readonly unknown[]) => {
          if (options.queryHandler && sql.startsWith('SELECT')) {
            return (await options.queryHandler(sql, values)) as { rows: T[] };
          }
          return { rows: [] as T[] };
        },
        release: () => undefined
      }),
      end: async () => undefined
    }
  };
}

function createSnapshotWithEdges(): DatabaseExplorerSchemaSnapshot {
  return {
    targetId: 'edutrack_production',
    targetLabel: 'EduTrack Production',
    checksum: 'mock_checksum_123',
    policyVersion: '2026-09-25',
    edges: [
      {
        constraint: 'attendance_student_id_fkey',
        from: { schema: 'public', relation: 'attendance', columns: ['student_id'] },
        to: { schema: 'public', relation: 'students', columns: ['id'] }
      }
    ],
    schemas: [
      {
        name: 'public',
        relations: [
          {
            name: 'students',
            kind: 'table',
            rowLevelSecurity: { enabled: false, forced: false },
            dataAvailable: true,
            estimatedRows: 10,
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
              }
            ]
          },
          {
            name: 'attendance',
            kind: 'table',
            rowLevelSecurity: { enabled: false, forced: false },
            dataAvailable: true,
            estimatedRows: 20,
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
                name: 'student_id',
                dataType: 'uuid',
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'internal',
                selectable: true,
                filterOperators: ['eq', 'neq']
              }
            ]
          }
        ]
      }
    ]
  };
}

describe('readRelatedRows', () => {
  const cursorKey = '01234567890123456789012345678901';

  it('traverses FK from parent students to child attendance rows', async () => {
    let executedSql = '';
    let executedValues: readonly unknown[] = [];

    const target = createMockTarget({
      queryHandler: async (sql, values) => {
        executedSql = sql;
        executedValues = values ?? [];
        return { rows: [{ id: 'att_1', student_id: 'std_123' }] };
      }
    });

    const snapshot = createSnapshotWithEdges();

    const rowRef = encodeRowRef(
      {
        version: 1,
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        checksum: 'mock_checksum_123',
        keys: { id: 'std_123' }
      },
      cursorKey
    );

    const request: DatabaseRelatedRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      constraint: 'attendance_student_id_fkey',
      rowRef,
      pageSize: 25,
      piiMode: 'masked'
    };

    const response = await readRelatedRows({
      target,
      snapshot,
      cursorKey,
      request
    });

    expect(response.relation).toBe('attendance');
    expect(executedSql).toContain('"student_id" = $1');
    expect(executedValues).toEqual(['std_123']);
    expect(response.rows).toHaveLength(1);
  });

  it('rejects missing or wrong constraint with DATABASE_RELATION_INVALID', async () => {
    const target = createMockTarget({});
    const snapshot = createSnapshotWithEdges();

    const rowRef = encodeRowRef(
      {
        version: 1,
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'students',
        checksum: 'mock_checksum_123',
        keys: { id: 'std_123' }
      },
      cursorKey
    );

    const request: DatabaseRelatedRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      constraint: 'non_existent_fk',
      rowRef,
      pageSize: 25,
      piiMode: 'masked'
    };

    await expect(
      readRelatedRows({
        target,
        snapshot,
        cursorKey,
        request
      })
    ).rejects.toThrowError(/DATABASE_RELATION_INVALID/);
  });

  it('rejects constraint when rowRef does not contain the needed key', async () => {
    const target = createMockTarget({});
    const snapshot = createSnapshotWithEdges();

    // rowRef from attendance without student_id key
    const rowRef = encodeRowRef(
      {
        version: 1,
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'attendance',
        checksum: 'mock_checksum_123',
        keys: { id: 'att_1' } // missing student_id
      },
      cursorKey
    );

    const request: DatabaseRelatedRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'attendance',
      constraint: 'attendance_student_id_fkey',
      rowRef,
      pageSize: 25,
      piiMode: 'masked'
    };

    await expect(
      readRelatedRows({
        target,
        snapshot,
        cursorKey,
        request
      })
    ).rejects.toThrowError(/DATABASE_RELATION_INVALID/);
  });
});
