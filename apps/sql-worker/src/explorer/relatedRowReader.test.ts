import { describe, expect, it } from 'vitest';
import { readRelatedRows } from './relatedRowReader.js';
import { encodeRowRef } from './cursorCodec.js';
import { readDatabaseRows } from './rowReader.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRelatedRowsRequest,
  DatabaseRowsRequest,
  DatabaseTargetId
} from '../../../../packages/contracts/src/databaseExplorer.js';
import { readProductionSchema } from '../schema/introspectSchema.js';

function createMockTarget(
  options: {
    queryHandler?: (
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: Record<string, unknown>[] }>;
  } = {}
): AvailableTargetEntry {
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
                  relationName: 'attendance',
                  kind: 'table',
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
                  hasDefault: false,
                  identity: '',
                  generated: ''
                },
                {
                  schemaName: 'public',
                  relationName: 'students',
                  columnName: 'tenant_id',
                  dataType: 'text',
                  nullable: false,
                  hasDefault: false,
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
                  relationName: 'attendance',
                  columnName: 'tenant_id',
                  dataType: 'text',
                  nullable: false,
                  hasDefault: false,
                  identity: '',
                  generated: ''
                },
                {
                  schemaName: 'public',
                  relationName: 'attendance',
                  columnName: 'id',
                  dataType: 'uuid',
                  nullable: false,
                  hasDefault: false,
                  identity: '',
                  generated: ''
                },
                {
                  schemaName: 'public',
                  relationName: 'attendance',
                  columnName: 'student_id',
                  dataType: 'uuid',
                  nullable: false,
                  hasDefault: false,
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
                },
                {
                  schemaName: 'public',
                  relationName: 'attendance',
                  constraintName: 'attendance_student_fkey',
                  kind: 'foreign_key',
                  columns: ['tenant_id', 'student_id'],
                  referencedSchema: 'public',
                  referencedRelation: 'students',
                  referencedColumns: ['tenant_id', 'id'],
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

function createSnapshotWithEdges(checksum = 'mock_checksum_123'): DatabaseExplorerSchemaSnapshot {
  return {
    targetId: 'edutrack_production',
    targetLabel: 'EduTrack Production',
    checksum,
    policyVersion: '2026-09-25-v2',
    edges: [
      {
        constraint: 'attendance_student_fkey',
        from: { schema: 'public', relation: 'attendance', columns: ['tenant_id', 'student_id'] },
        to: { schema: 'public', relation: 'students', columns: ['tenant_id', 'id'] }
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
                name: 'tenant_id',
                dataType: 'text',
                nullable: false,
                hasDefault: false,
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
                name: 'tenant_id',
                dataType: 'text',
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'internal',
                selectable: true,
                filterOperators: ['eq', 'neq']
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

async function createSnapshotForTarget(
  target: AvailableTargetEntry
): Promise<DatabaseExplorerSchemaSnapshot> {
  const connection = await target.pool.connect();
  try {
    const structural = await readProductionSchema({ database: connection });
    return createSnapshotWithEdges(structural.checksum);
  } finally {
    connection.release();
  }
}

describe('readRelatedRows', () => {
  const cursorKey = Buffer.alloc(32, 11).toString('base64');

  function rowRefFor(
    snapshot: DatabaseExplorerSchemaSnapshot,
    relation: string,
    keys: Record<string, unknown>,
    options: { targetId?: DatabaseTargetId; checksum?: string } = {}
  ): string {
    const issuedAt = Date.now();
    return encodeRowRef(
      {
        version: 1,
        targetId: options.targetId ?? 'edutrack_production',
        schema: 'public',
        relation,
        checksum: options.checksum ?? snapshot.checksum,
        issuedAt,
        expiresAt: issuedAt + 5 * 60 * 1000,
        keys
      },
      cursorKey
    );
  }

  function relatedRequest(
    relation: string,
    rowRef: string,
    constraint = 'attendance_student_fkey'
  ): DatabaseRelatedRowsRequest {
    return {
      targetId: 'edutrack_production',
      schema: 'public',
      relation,
      constraint,
      rowRef,
      pageSize: 25,
      piiMode: 'masked'
    };
  }

  function addSelectableColumn(
    snapshot: DatabaseExplorerSchemaSnapshot,
    relationName: string,
    columnName: string,
    dataType = 'text'
  ): void {
    const relation = snapshot.schemas
      .find((schema) => schema.name === 'public')
      ?.relations.find((candidate) => candidate.name === relationName);
    if (!relation) throw new Error(`Missing fixture relation ${relationName}`);
    if (relation.columns.some((column) => column.name === columnName)) return;
    relation.columns.push({
      name: columnName,
      dataType,
      nullable: false,
      hasDefault: false,
      identity: null,
      generated: false,
      classification: 'internal',
      selectable: true,
      filterOperators: ['eq', 'neq']
    });
  }

  it('traverses a composite FK from child to parent using source values outside the pagination key', async () => {
    const executed: Array<{ sql: string; values: readonly unknown[] }> = [];
    const target = createMockTarget({
      queryHandler: async (sql, values) => {
        executed.push({ sql, values: values ?? [] });
        if (sql.includes('FROM "public"."attendance"')) {
          return {
            rows: [{ id: 'att-child', tenant_id: 'tenant-child', student_id: 'student-child' }]
          };
        }
        return {
          rows: [{ id: 'student-child', tenant_id: 'tenant-child', email: 'child@example.test' }]
        };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    const sourceRequest: DatabaseRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'attendance',
      pageSize: 25,
      filters: [],
      piiMode: 'masked'
    };
    const sourceRows = await readDatabaseRows({
      target,
      snapshot,
      cursorKey,
      request: sourceRequest
    });
    const rowRef = sourceRows.rows[0]?.rowRef;
    expect(rowRef).toBeTruthy();
    expect(rowRef).not.toContain('tenant-child');
    expect(rowRef).not.toContain('student-child');

    const response = await readRelatedRows({
      target,
      snapshot,
      cursorKey,
      request: relatedRequest('attendance', rowRef!)
    });
    const parentSelect = executed.find(({ sql }) => sql.includes('FROM "public"."students"'));

    expect(response.relation).toBe('students');
    expect(parentSelect?.sql).toContain('"tenant_id" = $1 AND "id" = $2');
    expect(parentSelect?.values).toEqual(['tenant-child', 'student-child']);
    expect(response.rows).toHaveLength(1);
  });

  it('traverses the composite FK from parent to child using paired catalog order', async () => {
    const executed: Array<{ sql: string; values: readonly unknown[] }> = [];
    const target = createMockTarget({
      queryHandler: async (sql, values) => {
        executed.push({ sql, values: values ?? [] });
        if (sql.includes('FROM "public"."students"')) {
          return {
            rows: [
              { id: 'student-parent', tenant_id: 'tenant-parent', email: 'parent@example.test' }
            ]
          };
        }
        return {
          rows: [{ id: 'att-parent', tenant_id: 'tenant-parent', student_id: 'student-parent' }]
        };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    const sourceRows = await readDatabaseRows({
      target,
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
    const rowRef = sourceRows.rows[0]?.rowRef;
    expect(rowRef).toBeTruthy();

    const response = await readRelatedRows({
      target,
      snapshot,
      cursorKey,
      request: relatedRequest('students', rowRef!)
    });
    const childSelect = executed.find(({ sql }) => sql.includes('FROM "public"."attendance"'));

    expect(response.relation).toBe('attendance');
    expect(childSelect?.sql).toContain('"tenant_id" = $1 AND "student_id" = $2');
    expect(childSelect?.values).toEqual(['tenant-parent', 'student-parent']);
  });

  it('traverses composite FKs with more than five columns using bound claim values', async () => {
    const executed: Array<{ sql: string; values: readonly unknown[] }> = [];
    const target = createMockTarget({
      queryHandler: async (sql, values) => {
        executed.push({ sql, values: values ?? [] });
        return {
          rows: [{ id: 'student-1', tenant_id: 'tenant-1', email: 'student@example.test' }]
        };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    const sourceColumns = [
      'tenant_id',
      'region_id',
      'campus_id',
      'year_id',
      'course_id',
      'student_id'
    ];
    const targetColumns = ['tenant_id', 'region_id', 'campus_id', 'year_id', 'course_id', 'id'];
    for (const column of sourceColumns) addSelectableColumn(snapshot, 'attendance', column);
    for (const column of targetColumns) addSelectableColumn(snapshot, 'students', column);
    snapshot.edges[0] = {
      constraint: 'attendance_student_fkey',
      from: { schema: 'public', relation: 'attendance', columns: sourceColumns },
      to: { schema: 'public', relation: 'students', columns: targetColumns }
    };
    const values = ['tenant-1', 'region-2', 'campus-3', 'year-2026', 'course-5', 'student-6'];
    const rowRef = rowRefFor(snapshot, 'attendance', {
      tenant_id: values[0],
      region_id: values[1],
      campus_id: values[2],
      year_id: values[3],
      course_id: values[4],
      student_id: values[5]
    });

    await readRelatedRows({
      target,
      snapshot,
      cursorKey,
      request: relatedRequest('attendance', rowRef)
    });
    const relatedSelect = executed.find(({ sql }) => sql.includes('FROM "public"."students"'));

    expect(relatedSelect?.sql).toContain(
      '"tenant_id" = $1 AND "region_id" = $2 AND "campus_id" = $3 AND "year_id" = $4 AND "course_id" = $5 AND "id" = $6'
    );
    expect(relatedSelect?.values).toEqual(values);
  });

  it('binds long FK text values without applying the public filter length limit', async () => {
    const executed: Array<{ sql: string; values: readonly unknown[] }> = [];
    const target = createMockTarget({
      queryHandler: async (sql, values) => {
        executed.push({ sql, values: values ?? [] });
        return {
          rows: [{ id: 'student-long', tenant_id: 'tenant-long', email: 'long@example.test' }]
        };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    const longValue = `student-${'x'.repeat(250)}`;
    const rowRef = rowRefFor(snapshot, 'attendance', {
      tenant_id: 'tenant-long',
      student_id: longValue
    });

    await readRelatedRows({
      target,
      snapshot,
      cursorKey,
      request: relatedRequest('attendance', rowRef)
    });
    const relatedSelect = executed.find(({ sql }) => sql.includes('FROM "public"."students"'));

    expect(relatedSelect?.values).toEqual(['tenant-long', longValue]);
    expect(relatedSelect?.sql).toContain('"tenant_id" = $1 AND "id" = $2');
  });

  it('preserves supported non-string FK claim types in bound parameters', async () => {
    const executed: Array<{ sql: string; values: readonly unknown[] }> = [];
    const target = createMockTarget({
      queryHandler: async (sql, values) => {
        executed.push({ sql, values: values ?? [] });
        return {
          rows: [{ id: 'student-1', tenant_id: 'tenant-1', email: 'student@example.test' }]
        };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    addSelectableColumn(snapshot, 'attendance', 'active_flag', 'boolean');
    addSelectableColumn(snapshot, 'students', 'active_flag', 'boolean');
    snapshot.edges.push({
      constraint: 'attendance_active_fkey',
      from: { schema: 'public', relation: 'attendance', columns: ['active_flag'] },
      to: { schema: 'public', relation: 'students', columns: ['active_flag'] }
    });
    const rowRef = rowRefFor(snapshot, 'attendance', { active_flag: true });

    await readRelatedRows({
      target,
      snapshot,
      cursorKey,
      request: relatedRequest('attendance', rowRef, 'attendance_active_fkey')
    });
    const relatedSelect = executed.find(({ sql }) => sql.includes('FROM "public"."students"'));

    expect(relatedSelect?.sql).toContain('"active_flag" = $1');
    expect(relatedSelect?.values).toEqual([true]);
  });

  it('round-trips bytea FK claims as binary parameters without exposing their plaintext', async () => {
    const expectedBytes = Buffer.concat([
      Buffer.from('bytea-traversal-marker', 'utf8'),
      Buffer.from([0x00, 0xff])
    ]);
    const executed: Array<{ sql: string; values: readonly unknown[] }> = [];
    const target = createMockTarget({
      queryHandler: async (sql, values) => {
        executed.push({ sql, values: values ?? [] });
        if (sql.includes('FROM "public"."attendance"')) {
          return {
            rows: [
              {
                id: 'att-bytea',
                tenant_id: 'tenant-bytea',
                student_id: 'student-bytea',
                binary_key: expectedBytes
              },
              {
                id: 'att-oversized-bytea',
                tenant_id: 'tenant-bytea',
                student_id: 'student-bytea',
                binary_key: Buffer.alloc(5000, 7)
              }
            ]
          };
        }
        return {
          rows: [
            {
              id: 'student-bytea',
              tenant_id: 'tenant-bytea',
              email: 'bytea@example.test',
              binary_key: expectedBytes
            }
          ]
        };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    addSelectableColumn(snapshot, 'attendance', 'binary_key', 'bytea');
    addSelectableColumn(snapshot, 'students', 'binary_key', 'bytea');
    snapshot.edges.push({
      constraint: 'attendance_binary_fkey',
      from: { schema: 'public', relation: 'attendance', columns: ['binary_key'] },
      to: { schema: 'public', relation: 'students', columns: ['binary_key'] }
    });
    const sourceRows = await readDatabaseRows({
      target,
      snapshot,
      cursorKey,
      request: {
        targetId: 'edutrack_production',
        schema: 'public',
        relation: 'attendance',
        pageSize: 25,
        filters: [],
        piiMode: 'masked'
      }
    });
    const rowRef = sourceRows.rows[0]?.rowRef;
    expect(sourceRows.rows).toHaveLength(2);
    expect(rowRef).toBeTruthy();
    expect(sourceRows.rows[1]?.rowRef).toBeNull();
    expect(sourceRows.rows[1]?.cells.binary_key?.state).toBe('value');
    expect(rowRef).not.toContain('bytea-traversal-marker');

    await readRelatedRows({
      target,
      snapshot,
      cursorKey,
      request: relatedRequest('attendance', rowRef!, 'attendance_binary_fkey')
    });
    const relatedSelect = executed.find(({ sql }) => sql.includes('FROM "public"."students"'));

    expect(relatedSelect?.sql).toContain('"binary_key" = $1');
    expect(relatedSelect?.values).toHaveLength(1);
    expect(Buffer.isBuffer(relatedSelect?.values[0])).toBe(true);
    expect((relatedSelect?.values[0] as Buffer).equals(expectedBytes)).toBe(true);
  });

  it('rejects a blocked target FK column before any relation SELECT', async () => {
    const relationSelects: string[] = [];
    const target = createMockTarget({
      queryHandler: async (sql) => {
        relationSelects.push(sql);
        return { rows: [] };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    const studentId = snapshot.schemas[0]?.relations
      .find((relation) => relation.name === 'attendance')
      ?.columns.find((column) => column.name === 'student_id');
    if (!studentId) throw new Error('Missing fixture FK target column');
    studentId.classification = 'blocked';
    studentId.selectable = false;
    studentId.filterOperators = [];
    const rowRef = rowRefFor(snapshot, 'students', {
      tenant_id: 'tenant-1',
      id: 'student-1'
    });

    await expect(
      readRelatedRows({
        target,
        snapshot,
        cursorKey,
        request: relatedRequest('students', rowRef)
      })
    ).rejects.toThrowError(/DATABASE_FILTER_INVALID/);
    expect(relationSelects).toEqual([]);
  });

  it.each([
    { name: 'missing', keys: { id: 'att-1', student_id: 'student-1' } },
    { name: 'null', keys: { id: 'att-1', tenant_id: null, student_id: 'student-1' } }
  ])(
    'rejects a $name required composite source key before any relation SELECT',
    async ({ keys }) => {
      const relationSelects: string[] = [];
      const target = createMockTarget({
        queryHandler: async (sql) => {
          relationSelects.push(sql);
          return { rows: [] };
        }
      });
      const snapshot = await createSnapshotForTarget(target);
      const rowRef = rowRefFor(snapshot, 'attendance', keys);

      await expect(
        readRelatedRows({
          target,
          snapshot,
          cursorKey,
          request: relatedRequest('attendance', rowRef)
        })
      ).rejects.toThrowError(/DATABASE_RELATION_INVALID/);
      expect(relationSelects).toEqual([]);
    }
  );

  it.each([
    { name: 'unknown constraint', relation: 'attendance', constraint: 'missing_fk' },
    {
      name: 'unconnected source relation',
      relation: 'unrelated',
      constraint: 'attendance_student_fkey'
    }
  ])('rejects an $name before any relation SELECT', async ({ relation, constraint }) => {
    const relationSelects: string[] = [];
    const target = createMockTarget({
      queryHandler: async (sql) => {
        relationSelects.push(sql);
        return { rows: [] };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    const rowRef = rowRefFor(snapshot, relation, {
      tenant_id: 'tenant-1',
      student_id: 'student-1'
    });

    await expect(
      readRelatedRows({
        target,
        snapshot,
        cursorKey,
        request: relatedRequest(relation, rowRef, constraint)
      })
    ).rejects.toThrowError(/DATABASE_RELATION_INVALID/);
    expect(relationSelects).toEqual([]);
  });

  it.each([
    { name: 'wrong target', options: { targetId: 'ops' as const } },
    { name: 'stale checksum', options: { checksum: 'stale-checksum' } }
  ])('rejects a rowRef with $name before any relation SELECT', async ({ options }) => {
    const relationSelects: string[] = [];
    const target = createMockTarget({
      queryHandler: async (sql) => {
        relationSelects.push(sql);
        return { rows: [] };
      }
    });
    const snapshot = await createSnapshotForTarget(target);
    const rowRef = rowRefFor(
      snapshot,
      'attendance',
      { tenant_id: 'tenant-1', student_id: 'student-1' },
      options
    );

    await expect(
      readRelatedRows({
        target,
        snapshot,
        cursorKey,
        request: relatedRequest('attendance', rowRef)
      })
    ).rejects.toThrowError(/DATABASE_CURSOR_INVALID/);
    expect(relationSelects).toEqual([]);
  });
});
