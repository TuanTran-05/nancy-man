import { describe, expect, it } from 'vitest';

import { createExplorerSchemaReader } from './schemaReader.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import type { DatabasePolicyApproval } from './policyApproval.js';

function createMockTarget(
  options: {
    targetId?: 'edutrack_production' | 'ops';
    reltuples?: Record<string, number>;
    throwError?: boolean;
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
          query: async <T>(sql: string, values?: readonly unknown[]) => {
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
      version: '2026-09-25',
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

  it('rejects schema reading when live checksum does not match policy approval', async () => {
    const target = createMockTarget({ targetId: 'edutrack_production' });
    const approval: DatabasePolicyApproval = {
      version: '2026-09-25',
      targets: { edutrack_production: 'mismatched_checksum'.repeat(4) }
    };

    const reader = createExplorerSchemaReader({
      target,
      getPolicyApproval: () => approval
    });

    await expect(reader()).rejects.toThrowError('DATABASE_SCHEMA_STALE');
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

  it('handles connection error and does not poison subsequent requests', async () => {
    let shouldFail = true;
    const target = createMockTarget({ targetId: 'edutrack_production' });
    const originalConnect = target.pool.connect;
    target.pool.connect = async () => {
      if (shouldFail) {
        throw new Error('connection reset');
      }
      return originalConnect();
    };

    let currentTime = 1000;
    const reader = createExplorerSchemaReader({
      target,
      now: () => new Date(currentTime)
    });

    await expect(reader()).rejects.toThrow('connection reset');

    shouldFail = false;
    const snapshot1 = await reader();
    expect(snapshot1).toBeDefined();

    // Expire cache and fail on reconnect
    currentTime += 61_000;
    shouldFail = true;
    await expect(reader()).rejects.toThrow('connection reset');

    // Recover on next attempt
    shouldFail = false;
    const snapshot2 = await reader();
    expect(snapshot2).toBeDefined();
  });
});
