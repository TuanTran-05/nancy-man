import { describe, expect, it } from 'vitest';

import { createExplorerSchemaReader, invalidateExplorerSchemaCache } from './schemaReader.js';
import { DATABASE_POLICY_VERSION } from '../../../../packages/security/src/database/columnPolicy.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import type { DatabasePolicyApproval } from './policyApproval.js';
import { installOpsRuntimeTelemetry } from '../telemetry/runtimeTelemetry.js';

function createMockTarget(
  options: {
    targetId?: 'edutrack_production' | 'ops';
    reltuples?: Record<string, number>;
    throwError?: boolean;
    drift?: { enabled: boolean };
    blockedPrimaryKey?: boolean;
    catalogError?: {
      query: 'catalog:estimated_rows' | 'catalog:enum_columns';
      message: string;
    };
  } = {}
): AvailableTargetEntry {
  const targetId = options.targetId ?? 'edutrack_production';
  return {
    id: targetId,
    label: targetId === 'edutrack_production' ? 'EduTrack Production' : 'Ops Database',
    status: 'available',
    databaseName: 'edutrack_test',
    role: 'ops_database_browser',
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => {
        if (options.throwError) {
          throw new Error('connection failed');
        }
        return {
          release: () => undefined,
          query: async <T>(sql: string) => {
            if (options.catalogError && sql.includes(options.catalogError.query)) {
              throw new Error(options.catalogError.message);
            }
            if (sql.includes('catalog:schemas')) {
              return { rows: [{ schemaName: 'public' }, { schemaName: 'reporting' }] as T[] };
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
                  },
                  {
                    schemaName: 'public',
                    relationName: 'nullable_table',
                    kind: 'table',
                    rowSecurityEnabled: false,
                    forceRowSecurity: false
                  },
                  {
                    schemaName: 'public',
                    relationName: 'foreign_archive',
                    kind: 'foreign_table',
                    rowSecurityEnabled: false,
                    forceRowSecurity: false
                  },
                  {
                    schemaName: 'public',
                    relationName: 'mat_view',
                    kind: 'materialized_view',
                    rowSecurityEnabled: false,
                    forceRowSecurity: false
                  },
                  {
                    schemaName: 'reporting',
                    relationName: 'students',
                    kind: 'view',
                    rowSecurityEnabled: false,
                    forceRowSecurity: false
                  }
                ] as T[]
              };
            }
            if (sql.includes('catalog:estimated_rows')) {
              return {
                rows: [
                  { schemaName: 'public', relationName: 'students', estimatedRows: 1250 },
                  { schemaName: 'public', relationName: 'attendance', estimatedRows: 50000 }
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
                    relationName: 'attendance',
                    columnName: 'student_id',
                    dataType: 'uuid',
                    nullable: false,
                    hasDefault: false,
                    identity: '',
                    generated: ''
                  },
                  {
                    schemaName: 'public',
                    relationName: 'nullable_table',
                    columnName: 'opt_code',
                    dataType: 'text',
                    nullable: true,
                    hasDefault: false,
                    identity: '',
                    generated: ''
                  },
                  {
                    schemaName: 'public',
                    relationName: 'foreign_archive',
                    columnName: 'raw_data',
                    dataType: 'text',
                    nullable: true,
                    hasDefault: false,
                    identity: '',
                    generated: ''
                  },
                  {
                    schemaName: 'public',
                    relationName: 'students',
                    columnName: 'status',
                    dataType: 'student_status',
                    nullable: false,
                    hasDefault: false,
                    identity: '',
                    generated: ''
                  },
                  ...(options.drift?.enabled
                    ? [
                        {
                          schemaName: 'public',
                          relationName: 'students',
                          columnName: 'fresh_column',
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
            if (sql.includes('catalog:enum_columns')) {
              return {
                rows: [
                  { schemaName: 'public', relationName: 'students', columnName: 'status' }
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
                    columns: options.blockedPrimaryKey ? ['password_hash'] : ['id'],
                    referencedSchema: null,
                    referencedRelation: null,
                    referencedColumns: [],
                    deferrable: false,
                    initiallyDeferred: false
                  },
                  {
                    schemaName: 'public',
                    relationName: 'attendance',
                    constraintName: 'attendance_student_id_fkey',
                    kind: 'foreign_key',
                    columns: ['student_id'],
                    referencedSchema: 'public',
                    referencedRelation: 'students',
                    referencedColumns: ['id'],
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
                    schemaName: 'public',
                    relationName: 'students',
                    indexName: 'students_pkey',
                    method: 'btree',
                    columns: ['id'],
                    unique: true,
                    primary: true,
                    valid: true,
                    hasExpressions: false,
                    isPartial: false
                  },
                  {
                    schemaName: 'public',
                    relationName: 'nullable_table',
                    indexName: 'nullable_opt_code_unique',
                    method: 'btree',
                    columns: ['opt_code'],
                    unique: true,
                    primary: false,
                    valid: true,
                    hasExpressions: false,
                    isPartial: false
                  }
                ] as T[]
              };
            }
            return { rows: [] as T[] };
          }
        };
      },
      end: async () => undefined
    }
  };
}

describe('createExplorerSchemaReader', () => {
  it('enriches schema with targetId, edges, classifications, paginationKeys, and data availability', async () => {
    const target = createMockTarget({ targetId: 'edutrack_production' });
    const baselineReader = createExplorerSchemaReader({ target });
    const baseline = await baselineReader();

    const approval: DatabasePolicyApproval = {
      version: DATABASE_POLICY_VERSION,
      targets: {
        edutrack_production: baseline.checksum
      }
    };

    const reader = createExplorerSchemaReader({
      target,
      getPolicyApproval: () => approval
    });

    const snapshot = await reader();

    expect(snapshot.targetId).toBe('edutrack_production');
    expect(snapshot.edges).toContainEqual({
      constraint: 'attendance_student_id_fkey',
      from: { schema: 'public', relation: 'attendance', columns: ['student_id'] },
      to: { schema: 'public', relation: 'students', columns: ['id'] }
    });

    const publicSchema = snapshot.schemas.find((s) => s.name === 'public');
    expect(publicSchema).toBeDefined();

    const studentRelation = publicSchema?.relations.find((r) => r.name === 'students');
    expect(studentRelation).toBeDefined();
    expect(studentRelation?.primaryKey).toEqual(['id']);
    expect(studentRelation?.paginationKey).toEqual(['id']);
    expect(studentRelation?.estimatedRows).toBe(1250);
    expect(studentRelation?.dataAvailable).toBe(true);

    const studentCols = Object.fromEntries(studentRelation!.columns.map((c) => [c.name, c]));
    expect(studentCols.password_hash).toMatchObject({
      classification: 'blocked',
      selectable: false
    });
    expect(studentCols.email).toMatchObject({ classification: 'pii', selectable: true });
    expect(studentCols.id).toMatchObject({ classification: 'internal', selectable: true });
    expect(studentCols.status.filterOperators).toEqual(['eq', 'neq', 'is_null', 'is_not_null']);

    const nullableUnique = publicSchema?.relations.find((r) => r.name === 'nullable_table');
    expect(nullableUnique?.paginationKey).toBeNull();

    const foreignTable = publicSchema?.relations.find((r) => r.name === 'foreign_archive');
    expect(foreignTable?.dataAvailable).toBe(false);

    // Two schemas with same relation name
    const reportingSchema = snapshot.schemas.find((s) => s.name === 'reporting');
    const reportingStudents = reportingSchema?.relations.find((r) => r.name === 'students');
    expect(reportingStudents).toBeDefined();
    expect(reportingStudents?.kind).toBe('view');
  });

  it('keeps fresh unapproved columns visible as blocked metadata and withholds relation rows', async () => {
    const drift = { enabled: false };
    const target = createMockTarget({ targetId: 'edutrack_production', drift });
    let currentTime = 1000;
    const baseline = await createExplorerSchemaReader({
      target,
      now: () => new Date(currentTime)
    })();
    const approval: DatabasePolicyApproval = {
      version: DATABASE_POLICY_VERSION,
      targets: { edutrack_production: baseline.checksum }
    };

    const reader = createExplorerSchemaReader({
      target,
      getPolicyApproval: () => approval,
      now: () => new Date(currentTime)
    });
    expect((await reader()).schemas[0]?.relations[0]?.dataAvailable).toBe(true);

    drift.enabled = true;
    currentTime += 61_000;
    const changed = await reader();
    const students = changed.schemas
      .find((schema) => schema.name === 'public')
      ?.relations.find((relation) => relation.name === 'students');
    const freshColumn = students?.columns.find((column) => column.name === 'fresh_column');

    expect(freshColumn).toMatchObject({
      dataType: 'text',
      classification: 'blocked',
      selectable: false,
      filterOperators: []
    });
    expect(students?.dataAvailable).toBe(false);
  });

  it('does not use blocked key columns for row pagination references', async () => {
    const target = createMockTarget({ targetId: 'edutrack_production', blockedPrimaryKey: true });
    const baseline = await createExplorerSchemaReader({ target })();
    const approval: DatabasePolicyApproval = {
      version: DATABASE_POLICY_VERSION,
      targets: { edutrack_production: baseline.checksum }
    };
    const snapshot = await createExplorerSchemaReader({
      target,
      getPolicyApproval: () => approval
    })();
    const students = snapshot.schemas
      .find((schema) => schema.name === 'public')
      ?.relations.find((relation) => relation.name === 'students');

    expect(students?.primaryKey).toEqual(['password_hash']);
    expect(students?.columns.find((column) => column.name === 'password_hash')).toMatchObject({
      classification: 'blocked',
      selectable: false
    });
    expect(students?.paginationKey).toBeNull();
  });

  it.each([
    {
      query: 'catalog:estimated_rows',
      code: 'DATABASE_SCHEMA_METADATA_FAILED',
      rejects: false
    },
    {
      query: 'catalog:enum_columns',
      code: 'DATABASE_SCHEMA_CHECK_FAILED',
      rejects: true
    }
  ] as const)('does not send raw $query errors to telemetry', async ({ query, code, rejects }) => {
    const marker = 'database-error-contains-private-query-value';
    const target = createMockTarget({
      catalogError: { query, message: `database rejected ${marker}` }
    });
    const captured: Array<{ message: string; stack: string | undefined; code: string }> = [];
    const uninstall = installOpsRuntimeTelemetry({
      captureException: (error, context) => {
        captured.push({
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          code: context.code
        });
        return 'EVT_00000000000000000000000000';
      },
      flush: async () => undefined,
      healthy: () => true
    });

    try {
      const read = createExplorerSchemaReader({ target })();
      if (rejects) {
        await expect(read).rejects.toMatchObject({ message: code, code });
      } else {
        await expect(read).resolves.toBeDefined();
      }
    } finally {
      uninstall();
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ message: code, code });
    expect(JSON.stringify(captured)).not.toContain(marker);
  });

  it('caches the schema snapshot for 60 seconds and isolates between targets', async () => {
    let connectCount = 0;
    const target = createMockTarget({ targetId: 'edutrack_production' });
    const originalConnect = target.pool.connect;
    target.pool.connect = async () => {
      connectCount++;
      return originalConnect();
    };

    let currentTime = 1000;
    const reader = createExplorerSchemaReader({
      target,
      now: () => new Date(currentTime)
    });

    const snapshot1 = await reader();
    expect(connectCount).toBe(1);

    // Call again within TTL (advance 30 seconds)
    currentTime += 30_000;
    const snapshot2 = await reader();
    expect(connectCount).toBe(1);
    expect(snapshot2).toBe(snapshot1);

    // Advance past 60s TTL
    currentTime += 31_000;
    const snapshot3 = await reader();
    expect(connectCount).toBe(2);

    // Verify target isolation
    const opsTarget = createMockTarget({ targetId: 'ops' });
    const opsReader = createExplorerSchemaReader({
      target: opsTarget,
      now: () => new Date(currentTime)
    });
    const opsSnapshot = await opsReader();
    expect(opsSnapshot.targetId).toBe('ops');
    expect(opsSnapshot).not.toBe(snapshot3);
  });

  it('caps configured schema display cache lifetime at 60 seconds', async () => {
    let connectCount = 0;
    const target = createMockTarget({ targetId: 'edutrack_production' });
    const originalConnect = target.pool.connect;
    target.pool.connect = async () => {
      connectCount++;
      return originalConnect();
    };
    let currentTime = 1000;
    const reader = createExplorerSchemaReader({
      target,
      cacheTtlMs: 120_000,
      now: () => new Date(currentTime)
    });

    await reader();
    currentTime += 60_001;
    await reader();

    expect(connectCount).toBe(2);
  });

  it('invalidates schema display cache for only the stale target', async () => {
    const edutrack = createMockTarget({ targetId: 'edutrack_production' });
    const ops = createMockTarget({ targetId: 'ops' });
    let edutrackConnects = 0;
    let opsConnects = 0;
    const edutrackConnect = edutrack.pool.connect;
    const opsConnect = ops.pool.connect;
    edutrack.pool.connect = async () => {
      edutrackConnects++;
      return edutrackConnect();
    };
    ops.pool.connect = async () => {
      opsConnects++;
      return opsConnect();
    };
    const edutrackReader = createExplorerSchemaReader({ target: edutrack });
    const opsReader = createExplorerSchemaReader({ target: ops });

    await edutrackReader();
    await opsReader();
    invalidateExplorerSchemaCache(edutrack);
    await edutrackReader();
    await opsReader();

    expect(edutrackConnects).toBe(2);
    expect(opsConnects).toBe(1);
  });

  it('sanitizes connection errors and does not poison subsequent requests', async () => {
    let shouldFail = true;
    const marker = 'connection-error-private-database-url-marker';
    const target = createMockTarget({ targetId: 'edutrack_production' });
    const originalConnect = target.pool.connect;
    target.pool.connect = async () => {
      if (shouldFail) {
        throw new Error(marker);
      }
      return originalConnect();
    };

    let currentTime = 1000;
    const reader = createExplorerSchemaReader({
      target,
      now: () => new Date(currentTime)
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
      await expect(reader()).rejects.toMatchObject({
        message: 'DATABASE_SCHEMA_CHECK_FAILED',
        code: 'DATABASE_SCHEMA_CHECK_FAILED'
      });
    } finally {
      uninstall();
    }

    expect(captured).toEqual([
      { message: 'DATABASE_SCHEMA_CHECK_FAILED', code: 'DATABASE_SCHEMA_CHECK_FAILED' }
    ]);
    expect(JSON.stringify(captured)).not.toContain(marker);

    shouldFail = false;
    const snapshot1 = await reader();
    expect(snapshot1).toBeDefined();

    // Expire cache and fail on reconnect
    currentTime += 61_000;
    shouldFail = true;
    await expect(reader()).rejects.toMatchObject({
      message: 'DATABASE_SCHEMA_CHECK_FAILED',
      code: 'DATABASE_SCHEMA_CHECK_FAILED'
    });

    // Recover on next attempt
    shouldFail = false;
    const snapshot2 = await reader();
    expect(snapshot2).toBeDefined();
  });
});
