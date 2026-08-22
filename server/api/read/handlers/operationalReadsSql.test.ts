import { describe, expect, it } from 'vitest';
import { mapJobRow, mapNotificationRow } from './operationalReadsSql.js';

describe('PostgreSQL operational read projections', () => {
  it('rebuilds the DocumentStore jobs API shape', () => {
    expect(
      mapJobRow(
        {
          id: 'job-1',
          kind: 'export',
          name: 'full-export-sql',
          status: 'completed',
          params: { format: 'sql' },
          result: { rows: 10 },
          attempts: 1,
          requestedById: 'admin-1',
          requestedByRole: 'admin',
          startedAt: '2026-08-19 01:00:00+00',
          completedAt: '2026-08-19 01:00:02+00',
          durationMs: 2000,
          error: null,
          schemaVersion: 1,
          createdAt: '2026-08-19 01:00:00+00',
          updatedAt: '2026-08-19 01:00:02+00',
        },
        'Admin One'
      )
    ).toEqual({
      id: 'job-1',
      kind: 'export',
      name: 'full-export-sql',
      status: 'completed',
      params: { format: 'sql' },
      result: { rows: 10 },
      error: null,
      attempts: 1,
      requestedById: 'admin-1',
      requestedByRole: 'admin',
      startedAt: '2026-08-19T01:00:00.000Z',
      completedAt: '2026-08-19T01:00:02.000Z',
      durationMs: 2000,
      schemaVersion: 1,
      createdAt: '2026-08-19T01:00:00.000Z',
      updatedAt: '2026-08-19T01:00:02.000Z',
    });
  });

  it('keeps the complete materialized job shape', () => {
    const row = mapJobRow({
      id: 'job-2',
      kind: 'cleanup',
      name: 'cleanup',
      status: 'failed',
      params: {},
      result: {},
      attempts: 1,
      requestedById: null,
      requestedByRole: null,
      startedAt: '2026-08-19T01:00:00.000Z',
      completedAt: '2026-08-19T01:00:01.000Z',
      durationMs: 1000,
      error: { message: 'boom' },
      schemaVersion: 1,
      createdAt: '2026-08-19T01:00:00.000Z',
      updatedAt: '2026-08-19T01:00:01.000Z',
    });

    expect(row.result).toEqual({});
    expect(row.error).toEqual({ message: 'boom' });
  });

  it('hides teacher identity from the student projection', () => {
    const source = {
      id: 'notice-1',
      studentId: 'student-1',
      classId: 'class-1',
      teacherId: 'teacher-1',
      type: 'general',
      title: 'Title',
      message: 'Message',
      isRead: false,
      createdAt: '2026-08-19T01:00:00.000Z',
      updatedAt: '2026-08-19T01:00:00.000Z',
    };

    expect(mapNotificationRow(source, 'scoped')).not.toHaveProperty('teacherId');
    expect(mapNotificationRow(source, 'admin')).toHaveProperty('teacherId', 'teacher-1');
  });

  it('preserves an omitted notification updatedAt', () => {
    const source = {
      id: 'notice-without-update',
      studentId: 'student-1',
      classId: null,
      teacherId: null,
      type: 'general',
      title: 'Title',
      message: 'Message',
      isRead: false,
      createdAt: '2026-08-19T01:00:00.000Z',
      updatedAt: null,
    };

    expect(mapNotificationRow(source, 'admin')).toHaveProperty('updatedAt', null);
  });
});
