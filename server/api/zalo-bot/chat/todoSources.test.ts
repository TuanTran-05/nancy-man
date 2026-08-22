import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import type { UserContext } from '../../lib/auth/authz.js';

const mocks = vi.hoisted(() => ({
  listCanonicalClassRoster: vi.fn(),
  resolveAttendanceEligibilityBatch: vi.fn(),
  computeCourseClosingSnapshot: vi.fn(),
}));

vi.mock('../../lib/student/canonicalStudentReadRepository.js', () => ({
  listCanonicalClassRoster: mocks.listCanonicalClassRoster,
}));
vi.mock('../../lib/attendance/sessionEligibility.js', () => ({
  resolveAttendanceEligibilityBatch: mocks.resolveAttendanceEligibilityBatch,
}));
vi.mock('../../classes/helpers/courseClosing.js', () => ({
  computeCourseClosingSnapshot: mocks.computeCourseClosingSnapshot,
}));

import { collectZaloBotChatTodoSources } from './todoSources.js';

const teacherA: UserContext = { uid: 'teacher_a', role: 'teacher', name: 'A' };
const officeUser: UserContext = { uid: 'office_1', role: 'office', name: 'O' };
const adminUser: UserContext = { uid: 'admin_1', role: 'admin', name: 'Admin' };

describe('collectZaloBotChatTodoSources', () => {
  let memory: ReturnType<typeof createInMemoryDocumentStore>;
  let db: any;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = createInMemoryDocumentStore({
      'classes/c_a1': {
        name: '7A1',
        teacherId: 'teacher_a',
        status: 'active',
        daysOfWeek: [1],
        startDate: '2026-08-01',
        endDate: '2026-08-24',
      },
      'classes/c_b1': {
        name: '9C1',
        teacherId: 'teacher_b',
        status: 'active',
        daysOfWeek: [1],
        startDate: '2026-08-01',
        endDate: '2026-08-24',
      },
      'print_requests/p1': {
        className: '7A1',
        teacherName: 'Cô A',
        neededDate: '2026-08-18',
        status: 'pending',
        files: [{ name: 'worksheet.pdf' }],
        totalCopies: 20,
      },
    });
    db = memory.db;
    mocks.listCanonicalClassRoster.mockResolvedValue([
      {
        canonicalProfileId: 's1',
        profile: {
          id: 's1',
          name: 'A',
          leavePeriods: [],
          courseJoins: [],
          enrollmentDate: '2026-08-01',
        },
      },
    ]);
    mocks.resolveAttendanceEligibilityBatch.mockResolvedValue(
      new Map([['s1', { eligibility: 'eligible' }]])
    );
    mocks.computeCourseClosingSnapshot.mockResolvedValue({ status: 'pending' });
  });

  it('never reads the whole users collection', async () => {
    await collectZaloBotChatTodoSources(db, teacherA, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });
    expect(memory.readLog).not.toContain('query:users');
  });

  it('scopes classes to the actor', async () => {
    const sources = await collectZaloBotChatTodoSources(db, teacherA, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });
    expect(sources.attendance.map((row) => row.classId)).toEqual(['c_a1']);
  });

  it('re-checks every class and never runs a date-only session or attendance query', async () => {
    await collectZaloBotChatTodoSources(db, teacherA, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });

    expect(memory.readLog).toContain('classes/c_a1');
    expect(memory.readLog).not.toContain('classes/c_b1');

    for (const query of memory.queryLog.filter((row) =>
      ['class_sessions', 'attendance'].includes(row.collection)
    )) {
      expect(query.filters).toEqual(
        expect.arrayContaining([
          ['classId', '==', 'c_a1'],
          ['date', '==', '2026-08-17'],
        ])
      );
    }
  });

  it('passes full profile fields into attendance eligibility', async () => {
    await collectZaloBotChatTodoSources(db, teacherA, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });

    const input = mocks.resolveAttendanceEligibilityBatch.mock.calls[0][1];
    expect(input.studentsById.get('s1')).toMatchObject({
      courseJoins: [],
      leavePeriods: [],
      enrollmentDate: '2026-08-01',
    });
  });

  it('lists exactly one recipient, the actor', async () => {
    const sources = await collectZaloBotChatTodoSources(db, teacherA, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });
    expect(sources.activeRecipients).toEqual([
      { staffId: 'teacher_a', role: 'teacher', displayName: 'A', chatIdHash: '' },
    ]);
  });

  it('includes a class closing in exactly seven days', async () => {
    const sources = await collectZaloBotChatTodoSources(db, teacherA, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });
    expect(sources.courseClosing.map((row) => row.classId)).toEqual(['c_a1']);
  });

  it('leaves print requests empty for a teacher', async () => {
    const sources = await collectZaloBotChatTodoSources(db, teacherA, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });
    expect(sources.printRequests).toEqual([]);
  });

  it('does not read class work for office because its todo contains only print requests', async () => {
    await collectZaloBotChatTodoSources(db, officeUser, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });

    expect(memory.queryLog.some((row) => row.collection === 'classes')).toBe(false);
    expect(memory.queryLog.some((row) => row.collection === 'class_sessions')).toBe(false);
    expect(memory.queryLog.some((row) => row.collection === 'attendance')).toBe(false);
    expect(mocks.listCanonicalClassRoster).not.toHaveBeenCalled();
    expect(mocks.computeCourseClosingSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'office', actor: officeUser },
    { label: 'admin', actor: adminUser },
  ])('includes pending print requests for $label', async ({ actor }) => {
    const sources = await collectZaloBotChatTodoSources(db, actor, {
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
    });
    expect(sources.printRequests).toEqual([
      expect.objectContaining({ requestId: 'p1', className: '7A1', totalCopies: 20 }),
    ]);
  });
});
