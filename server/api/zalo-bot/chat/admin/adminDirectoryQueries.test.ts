import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import {
  queryAdminCenterHeadcount,
  queryAdminStudentLookup,
  queryAdminStudentPhone,
} from './adminDirectoryQueries.js';
import type { ResolvedCanonicalStudent } from './adminEntityResolver.js';

describe('adminDirectoryQueries', () => {
  const mockStudent: ResolvedCanonicalStudent = {
    id: 's1',
    fullName: 'Nguyễn Văn Minh',
    studentCode: 'HV01',
    currentClassId: 'c1',
    currentClassName: 'Movers 1',
    currentTeacherId: 't1',
    teacherName: 'Cô Lan',
    placementStatus: 'studying',
  };

  it('queries student lookup data', async () => {
    const { db } = createInMemoryDocumentStore({});
    const res = await queryAdminStudentLookup(db as any, mockStudent);

    expect(res.kind).toBe('directory_lookup');
    expect(res.student?.fullName).toBe('Nguyễn Văn Minh');
    expect(res.student?.placementStatus).toBe('studying');
    expect(res.quality.status).toBe('complete');
  });

  it('queries student phone contact', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/s1': {
        name: 'Nguyễn Văn Minh',
        contact: '0912345678',
      },
    });

    const res = await queryAdminStudentPhone(db as any, mockStudent);

    expect(res.kind).toBe('student_phone');
    expect(res.student.phone).toBe('0912345678');
    expect(res.quality.status).toBe('complete');
  });

  it('reports degraded quality when phone contact is missing', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/s1': {
        name: 'Nguyễn Văn Minh',
      },
    });

    const res = await queryAdminStudentPhone(db as any, mockStudent);

    expect(res.student.phone).toBe('');
    expect(res.quality.status).toBe('degraded');
    expect(res.quality.issues[0].code).toBe('source_incomplete');
  });

  it('queries 5-state center headcount from DashboardReadModelV3 with accurate quality and timestamps', async () => {
    const now = new Date('2026-08-16T10:00:00Z');
    const { db } = createInMemoryDocumentStore({
      'read_models/dashboard_global': {
        canonicalHeadcount: {
          schemaVersion: 3,
          canonicalProfileCount: 150,
          studyingCanonicalCount: 120,
          trialCanonicalCount: 10,
          onLeaveCanonicalCount: 5,
          waitingForPlacementCanonicalCount: 3,
          inactiveCanonicalCount: 12,
          complete: true,
          generatedAt: '2026-08-16T09:55:00Z', // 5m old -> fresh
          sourceUpdatedAt: '2026-08-16T09:50:00Z',
        },
      },
    });

    const res = await queryAdminCenterHeadcount(db as any, now);

    expect(res.kind).toBe('center_headcount');
    expect(res.totalCanonical).toBe(150);
    expect(res.breakdown.studying).toBe(120);
    expect(res.breakdown.trial).toBe(10);
    expect(res.breakdown.on_leave).toBe(5);
    expect(res.breakdown.waiting_for_placement).toBe(3);
    expect(res.breakdown.inactive).toBe(12);
    expect(res.quality.status).toBe('complete');
    expect(res.sourceAsOf).toBe('2026-08-16T09:50:00Z');
  });

  it('flags stale headcount model as degraded quality', async () => {
    const now = new Date('2026-08-16T12:00:00Z');
    const { db } = createInMemoryDocumentStore({
      'read_models/dashboard_global': {
        canonicalHeadcount: {
          schemaVersion: 3,
          canonicalProfileCount: 150,
          studyingCanonicalCount: 120,
          trialCanonicalCount: 10,
          onLeaveCanonicalCount: 5,
          waitingForPlacementCanonicalCount: 3,
          inactiveCanonicalCount: 12,
          complete: true,
          generatedAt: '2026-08-16T09:00:00Z', // 3 hours old -> stale
          sourceUpdatedAt: '2026-08-16T09:00:00Z',
        },
      },
    });

    const res = await queryAdminCenterHeadcount(db as any, now);

    expect(res.quality.status).toBe('degraded');
    expect(res.quality.issues.some((i) => i.code === 'stale')).toBe(true);
  });
});
