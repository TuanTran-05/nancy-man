import { describe, expect, it, vi } from 'vitest';
import {
  aggregateDashboardReadModel,
  DASHBOARD_READ_MODEL_MAX_AGE_MS,
  isDashboardReadModelFresh,
} from './dashboardAggregateService.js';

type Filter = { field: string; op: string; value: unknown };

function makeCountQuery(collectionName: string, counts: Record<string, number>) {
  const filters: Filter[] = [];
  const query: any = {
    where: vi.fn((field: string, op: string, value: unknown) => {
      filters.push({ field, op, value });
      return query;
    }),
    count: vi.fn(() => ({
      get: vi.fn(async () => ({
        data: () => ({
          count:
            counts[
              [collectionName, ...filters.map((f) => `${f.field}${f.op}${String(f.value)}`)].join(
                '|'
              )
            ] ??
            counts[collectionName] ??
            0,
        }),
      })),
    })),
  };
  return query;
}

describe('dashboardAggregateService', () => {
  it('stores a compact dashboard read model with count aggregates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T01:00:00.000Z'));
    const readModelRef = { set: vi.fn().mockResolvedValue(undefined) };
    const counts = {
      students: 1000,
      'classes|status==active': 42,
      classes: 50,
      'users|role==teacher': 18,
      'payment_requests|status==pending': 7,
      'payment_requests|status==needs_review': 2,
      'zalo_notifications|status==failed': 3,
    };
    const studentDoc = (fields: Record<string, unknown>) => ({
      id: String(fields.studentId || fields.name || ''),
      get: (field: string) => fields[field],
    });
    const studentDocs = [
      studentDoc({
        classId: 'class-1',
        enrollmentStatus: 'active',
        studentId: 'HS01',
        name: 'An',
        dob: '2012-01-01',
        contact: '0900000001',
        gender: 'male',
      }),
      studentDoc({
        classId: 'class-1',
        enrollmentStatus: 'active',
        studentId: 'HS02',
        name: 'Binh',
        dob: '2012-02-02',
        contact: '0900000002',
        gender: 'female',
      }),
      studentDoc({
        classId: 'class-1',
        enrollmentStatus: 'on_leave',
        studentId: 'HS03',
        name: 'Cuong',
        dob: '2012-03-03',
        contact: '0900000003',
        gender: 'male',
      }),
      studentDoc({
        classId: 'class-2',
        enrollmentStatus: 'dropped',
        studentId: 'HS04',
        name: 'Dung',
        dob: '2012-04-04',
        contact: '0900000004',
        gender: 'female',
      }),
      studentDoc({
        classId: 'class-2',
        enrollmentStatus: 'active',
        studentId: 'HS05',
        name: 'Em',
        dob: '2012-05-05',
        contact: '0900000005',
      }),
      studentDoc({
        classId: 'class-2',
        studentLifecycle: 'trial',
        enrollmentStatus: 'active',
        studentId: 'HS06',
        name: 'Giang',
        dob: '2012-06-06',
        contact: '0900000006',
        gender: 'female',
      }),
    ];
    const evaluationDocs = [
      { data: () => ({ studentId: 'student-1', date: '2026-05-01', finalScore: 70 }) },
      { data: () => ({ studentId: 'student-1', date: '2026-05-20', finalScore: 95 }) },
      { data: () => ({ studentId: 'student-2', date: '2026-05-20', finalScore: 8.2 }) },
      { data: () => ({ studentId: 'student-3', date: '2026-05-20', totalScore: 70 }) },
      { data: () => ({ studentId: 'student-4', date: '2026-05-20', finalScore: 40 }) },
    ];
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'read_models') return { doc: vi.fn(() => readModelRef) };
        if (name === 'realtime_events') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ data: () => ({ version: 17 }) }),
            })),
          };
        }
        if (name === 'students') {
          return {
            ...makeCountQuery(name, counts),
            select: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: studentDocs }) })),
          };
        }
        if (name === 'evaluations') {
          return {
            select: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: evaluationDocs }) })),
          };
        }
        return makeCountQuery(name, counts);
      }),
    };

    const model = await aggregateDashboardReadModel(db as any);

    expect(model).toMatchObject({
      id: 'dashboard_global',
      counts: {
        students: 1000,
        // 6 docs; Dung is `dropped` so the roster excludes her -> 5 current students.
        currentStudents: 5,
        classes: 50,
        activeClasses: 42,
        teachers: 18,
        pendingPayments: 7,
        paymentsNeedingReview: 2,
        failedNotifications: 3,
      },
      classStudentCounts: {
        'class-1': { total: 3, active: 2, onLeave: 1, dropped: 0, promoted: 0 },
        'class-2': { total: 2, active: 2, onLeave: 0, dropped: 0, promoted: 0 },
      },
      // Giang is a trial student and is not part of the enrolled-active count.
      activeStudents: 3,
      // Dung is excluded, while enrolled Binh and trial Giang remain female.
      genderCounts: { male: 2, female: 2, other: 1 },
      performanceCounts: { excellent: 1, good: 1, fair: 1, average: 1 },
      sourceVersions: { students: 17 },
      generatedAt: '2026-05-21T01:00:00.000Z',
      schemaVersion: 3,
    });
    expect(
      Object.values(model.classStudentCounts).reduce((sum, count) => sum + count.total, 0)
    ).toBe(model.counts.currentStudents);
    expect(readModelRef.set).toHaveBeenCalledWith(model, { merge: true });
    vi.useRealTimers();
  });

  it('excludes archived and duplicate records from the canonical headcount', async () => {
    const readModelRef = { set: vi.fn().mockResolvedValue(undefined) };
    const counts = { students: 6 };
    const studentDoc = (fields: Record<string, unknown>) => ({
      id: String(fields.studentId || ''),
      get: (field: string) => fields[field],
    });
    const studentDocs = [
      // One real student.
      studentDoc({
        classId: 'class-1',
        enrollmentStatus: 'active',
        studentId: 'HS01',
        name: 'Nguyen Van A',
        dob: '2012-01-01',
        contact: '0900000001',
        gender: 'male',
      }),
      // Same identity recorded twice -> collapses into the record above.
      studentDoc({
        classId: 'class-1',
        enrollmentStatus: 'on_leave',
        studentId: 'HS01-OLD',
        name: 'Nguyen Van A',
        dob: '2012-01-01',
        contact: '0900000001',
        gender: 'male',
      }),
      // Historical promoted copy of the same student.
      studentDoc({
        classId: 'class-0',
        enrollmentStatus: 'promoted',
        studentId: 'HS01',
        name: 'Nguyen Van A',
        dob: '2012-01-01',
        contact: '0900000001',
        gender: 'male',
      }),
      // Revoked and soft-deleted records are not part of the roster.
      studentDoc({
        classId: 'class-1',
        enrollmentStatus: 'active',
        studentId: 'HS02',
        name: 'Tran Thi B',
        dob: '2012-02-02',
        contact: '0900000002',
        isRevoked: true,
      }),
      studentDoc({
        classId: 'class-1',
        enrollmentStatus: 'active',
        studentId: 'HS03',
        name: 'Le Van C',
        dob: '2012-03-03',
        contact: '0900000003',
        deletedAt: '2026-05-01T00:00:00.000Z',
      }),
      // A second genuine student.
      studentDoc({
        classId: 'class-2',
        enrollmentStatus: 'active',
        studentId: 'HS04',
        name: 'Pham Thi D',
        dob: '2012-04-04',
        contact: '0900000004',
        gender: 'female',
      }),
    ];
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'read_models') return { doc: vi.fn(() => readModelRef) };
        if (name === 'realtime_events') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ data: () => ({ version: 23 }) }),
            })),
          };
        }
        if (name === 'students') {
          return {
            ...makeCountQuery(name, counts),
            select: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: studentDocs }) })),
          };
        }
        if (name === 'evaluations') {
          return { select: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) };
        }
        return makeCountQuery(name, counts);
      }),
    };

    const model = await aggregateDashboardReadModel(db as any);

    // 6 raw documents collapse to 2 real students.
    expect(model.counts.students).toBe(6);
    expect(model.counts.currentStudents).toBe(2);

    // The invariant the dashboard depends on: the breakdown sums to the total.
    const genderTotal =
      model.genderCounts.male + model.genderCounts.female + model.genderCounts.other;
    expect(genderTotal).toBe(model.counts.currentStudents);
    expect(model.activeStudents).toBeLessThanOrEqual(model.counts.currentStudents);
    expect(
      Object.values(model.classStudentCounts).reduce((sum, count) => sum + count.total, 0)
    ).toBe(model.counts.currentStudents);
  });
});

describe('isDashboardReadModelFresh', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const currentModel = {
    schemaVersion: 3,
    generatedAt: '2026-08-10T11:55:00.000Z',
    counts: { currentStudents: 638 },
    sourceVersions: { students: 42 },
  };

  it('accepts a current model at the latest students event version', () => {
    expect(isDashboardReadModelFresh(currentModel, 42, now)).toBe(true);
  });

  it('rejects the old schema-2 snapshot even when its timestamp is recent', () => {
    expect(isDashboardReadModelFresh({ ...currentModel, schemaVersion: 2 }, 42, now)).toBe(false);
  });

  it('rejects a model produced before the latest students event', () => {
    expect(isDashboardReadModelFresh(currentModel, 43, now)).toBe(false);
  });

  it('rejects a model that exceeded the aggregate safety window', () => {
    const generatedAt = new Date(now.getTime() - DASHBOARD_READ_MODEL_MAX_AGE_MS - 1).toISOString();
    expect(isDashboardReadModelFresh({ ...currentModel, generatedAt }, 42, now)).toBe(false);
  });
});
