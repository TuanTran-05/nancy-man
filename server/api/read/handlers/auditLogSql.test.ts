import { describe, expect, it } from 'vitest';
import { mapAuditLogRow } from './auditLogSql.js';

describe('mapAuditLogRow', () => {
  it('restores the materialized DocumentStore audit shape', () => {
    const result = mapAuditLogRow({
      id: 'log-1',
      occurredAt: '2026-08-19 05:30:00+00',
      userId: 'admin-1',
      userRole: 'admin',
      userName: null,
      action: 'update',
      entityTable: 'students',
      entityId: 'student-1',
      ip: null,
      userAgent: null,
      changes: { status: 'active' },
      metadata: null,
    });

    expect(result).toEqual({
      id: 'log-1',
      occurredAt: '2026-08-19T05:30:00.000Z',
      timestamp: '2026-08-19T05:30:00.000Z',
      userId: 'admin-1',
      userRole: 'admin',
      userName: null,
      action: 'update',
      entityTable: 'students',
      collection: 'students',
      entityId: 'student-1',
      documentId: 'student-1',
      ip: null,
      userAgent: null,
      changes: { status: 'active' },
      metadata: null,
    });
  });

  it('camel-cases nested JSON fields like the document materializer', () => {
    const result = mapAuditLogRow({
      id: 'log-2',
      occurredAt: '2026-08-19 05:30:00+00',
      userId: 'teacher-1',
      userRole: 'teacher',
      userName: null,
      action: 'update',
      entityTable: 'attendance',
      entityId: 'attendance-1',
      ip: null,
      userAgent: null,
      changes: null,
      metadata: { skipped: { not_enrolled: [], on_leave: [] } },
    });

    expect(result.metadata).toEqual({ skipped: { notEnrolled: [], onLeave: [] } });
  });
});
