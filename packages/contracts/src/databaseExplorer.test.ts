import { describe, expect, it } from 'vitest';

import {
  DATABASE_TARGET_IDS,
  isDatabasePageSize,
  isDatabaseTargetId,
  type DatabaseCell,
  type DatabaseColumnClassification,
  type DatabaseExplorerColumn,
  type DatabaseExplorerSchemaSnapshot,
  type DatabaseFilterOperator,
  type DatabaseRelatedRowsRequest,
  type DatabaseRelationEdge,
  type DatabaseRowsRequest,
  type DatabaseRowsResponse,
  type DatabaseTargetId,
  type DatabaseTargetSummary
} from './databaseExplorer.js';

describe('Database explorer contracts', () => {
  it('keeps targets closed and row page sizes bounded', () => {
    expect(DATABASE_TARGET_IDS).toEqual(['edutrack_production', 'ops']);
    expect(isDatabasePageSize(25)).toBe(true);
    expect(isDatabasePageSize(50)).toBe(true);
    expect(isDatabasePageSize(100)).toBe(true);
    expect(isDatabasePageSize(101)).toBe(false);
    expect(isDatabasePageSize(0)).toBe(false);
    expect(isDatabasePageSize(-1)).toBe(false);
    expect(isDatabasePageSize('25')).toBe(false);
  });

  it('validates target IDs with isDatabaseTargetId', () => {
    expect(isDatabaseTargetId('edutrack_production')).toBe(true);
    expect(isDatabaseTargetId('ops')).toBe(true);
    expect(isDatabaseTargetId('other_db')).toBe(false);
    expect(isDatabaseTargetId('')).toBe(false);
    expect(isDatabaseTargetId(null)).toBe(false);
  });

  it('shapes valid explorer DTOs without type errors', () => {
    const classification: DatabaseColumnClassification = 'pii';
    const operator: DatabaseFilterOperator = 'eq';
    const targetId: DatabaseTargetId = 'edutrack_production';

    const cellValue: DatabaseCell = { state: 'value', value: 'hello' };
    const cellMasked: DatabaseCell = { state: 'masked', display: 't***@example.com' };
    const cellBlocked: DatabaseCell = { state: 'blocked' };
    const cellTruncated: DatabaseCell = {
      state: 'truncated',
      display: 'abc',
      originalBytes: 100000
    };

    expect([cellValue, cellMasked, cellBlocked, cellTruncated]).toHaveLength(4);

    const edge: DatabaseRelationEdge = {
      constraint: 'attendance_student_id_fkey',
      from: { schema: 'public', relation: 'attendance', columns: ['student_id'] },
      to: { schema: 'public', relation: 'students', columns: ['id'] }
    };
    expect(edge.constraint).toBe('attendance_student_id_fkey');

    const col: DatabaseExplorerColumn = {
      name: 'email',
      dataType: 'text',
      nullable: false,
      hasDefault: false,
      identity: null,
      generated: false,
      classification,
      selectable: true,
      filterOperators: [operator]
    };
    expect(col.classification).toBe('pii');

    const targetSummary: DatabaseTargetSummary = {
      id: targetId,
      label: 'EduTrack Production',
      status: 'available',
      readOnly: true
    };
    expect(targetSummary.status).toBe('available');

    const rowsReq: DatabaseRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [{ column: 'id', operator: 'eq', value: '1' }],
      piiMode: 'masked'
    };
    expect(rowsReq.pageSize).toBe(25);

    const relatedReq: DatabaseRelatedRowsRequest = {
      targetId: 'edutrack_production',
      schema: 'public',
      relation: 'attendance',
      constraint: 'attendance_student_id_fkey',
      rowRef: 'ref-1',
      pageSize: 25,
      piiMode: 'masked'
    };
    expect(relatedReq.constraint).toBe('attendance_student_id_fkey');

    const rowsRes: DatabaseRowsResponse = {
      targetId: 'edutrack_production',
      schemaChecksum: 'checksum1',
      policyVersion: '2026-09-25',
      schema: 'public',
      relation: 'students',
      columns: [col],
      rows: [{ rowRef: 'ref-1', cells: { email: cellMasked } }],
      nextCursor: null,
      truncated: false,
      encodedBytes: 128,
      consistency: 'stable',
      piiMode: 'masked'
    };
    expect(rowsRes.consistency).toBe('stable');

    const snapshot: DatabaseExplorerSchemaSnapshot = {
      targetId: 'edutrack_production',
      targetLabel: 'EduTrack Production',
      checksum: 'snap-checksum',
      policyVersion: '2026-09-25',
      schemas: [],
      edges: [edge]
    };
    expect(snapshot.targetId).toBe('edutrack_production');
  });
});
