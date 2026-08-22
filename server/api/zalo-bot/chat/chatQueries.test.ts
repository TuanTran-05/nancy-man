import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import type { UserContext } from '../../lib/auth/authz.js';

const todoMocks = vi.hoisted(() => ({
  collectZaloBotChatTodoSources: vi.fn(),
}));

vi.mock('./todoSources.js', () => ({
  collectZaloBotChatTodoSources: todoMocks.collectZaloBotChatTodoSources,
}));

const attendanceMocks = vi.hoisted(() => ({
  resolveAttendanceEligibilityBatch: vi.fn(),
}));

vi.mock('../../lib/attendance/sessionEligibility.js', () => ({
  resolveAttendanceEligibilityBatch: attendanceMocks.resolveAttendanceEligibilityBatch,
}));

const rosterMocks = vi.hoisted(() => ({
  listCanonicalClassRoster: vi.fn(),
  listCanonicalClassRosterProfiles: vi.fn(),
}));

vi.mock('../../lib/student/canonicalStudentReadRepository.js', () => ({
  listCanonicalClassRoster: rosterMocks.listCanonicalClassRoster,
}));

vi.mock('../../lib/student/canonicalClassRoster.js', () => ({
  listCanonicalClassRosterProfiles: rosterMocks.listCanonicalClassRosterProfiles,
}));

import {
  runClassEndDate,
  runClassStudentCount,
  runClassStudentList,
  runAttendanceToday,
  runMyTodo,
  ZALO_BOT_CHAT_MAX_LISTED_STUDENTS,
} from './chatQueries.js';

const teacherA: UserContext = { uid: 'teacher_a', role: 'teacher', name: 'A' };

describe('chatQueries roster', () => {
  let db: any;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createInMemoryDocumentStore({
      'classes/c_a1': {
        name: '7A1',
        teacherId: 'teacher_a',
        status: 'active',
        endDate: '2026-12-31',
      },
      'classes/c_b1': {
        name: '9C1',
        teacherId: 'teacher_b',
        status: 'active',
        endDate: '2026-11-30',
      },
    }).db;
  });

  it('counts a roster by enrollment status', async () => {
    rosterMocks.listCanonicalClassRoster.mockResolvedValue([
      { currentEnrollment: { status: 'active' } },
      { currentEnrollment: { status: 'active' } },
      { currentEnrollment: { status: 'on_leave' } },
      { currentEnrollment: { status: 'trial' } },
    ]);

    const answer = await runClassStudentCount(db, teacherA, {
      classId: 'c_a1',
      className: '7A1',
    });

    expect(answer).toEqual({
      kind: 'student_count',
      className: '7A1',
      active: 2,
      onLeave: 1,
      trial: 1,
    });
  });

  it('falls back to the scoped enrollment when there is no current one', async () => {
    rosterMocks.listCanonicalClassRoster.mockResolvedValue([
      { currentEnrollment: null, scopedEnrollment: { status: 'active' } },
    ]);

    const answer = await runClassStudentCount(db, teacherA, {
      classId: 'c_a1',
      className: '7A1',
    });

    expect(answer).toMatchObject({ active: 1 });
  });

  // Chốt chặn thứ ba: executor tự kiểm quyền, không tin bước giải tên lớp.
  it('refuses a class the actor does not teach even when handed the id', async () => {
    const answer = await runClassStudentCount(db, teacherA, {
      classId: 'c_b1',
      className: '9C1',
    });

    expect(answer).toEqual({ kind: 'class_not_found', hint: '9C1' });
    expect(rosterMocks.listCanonicalClassRoster).not.toHaveBeenCalled();
  });

  it('refuses a class that does not exist', async () => {
    const answer = await runClassStudentCount(db, teacherA, {
      classId: 'c_missing',
      className: 'X',
    });

    expect(answer).toEqual({ kind: 'class_not_found', hint: 'X' });
    expect(rosterMocks.listCanonicalClassRoster).not.toHaveBeenCalled();
  });

  it('propagates an infrastructure error instead of disguising it as not_found', async () => {
    const brokenDb = {
      collection: () => ({
        doc: () => ({ get: async () => Promise.reject(new Error('documentStore unavailable')) }),
      }),
    };

    await expect(
      runClassStudentCount(brokenDb as any, teacherA, { classId: 'c_a1', className: '7A1' })
    ).rejects.toThrow('documentStore unavailable');
  });

  it('lists student names', async () => {
    rosterMocks.listCanonicalClassRosterProfiles.mockResolvedValue([
      { id: 's1', name: 'NGUYỄN VĂN A' },
      { id: 's2', name: 'TRẦN THỊ B' },
    ]);

    const answer = await runClassStudentList(db, teacherA, {
      classId: 'c_a1',
      className: '7A1',
    });

    expect(answer).toEqual({
      kind: 'student_list',
      className: '7A1',
      names: ['NGUYỄN VĂN A', 'TRẦN THỊ B'],
      omitted: 0,
    });
  });

  it('caps the list and reports the remainder', async () => {
    const many = Array.from({ length: ZALO_BOT_CHAT_MAX_LISTED_STUDENTS + 5 }, (_, i) => ({
      id: `s${i}`,
      name: `HS ${i}`,
    }));
    rosterMocks.listCanonicalClassRosterProfiles.mockResolvedValue(many);

    const answer = await runClassStudentList(db, teacherA, {
      classId: 'c_a1',
      className: '7A1',
    });

    expect(answer).toMatchObject({
      names: expect.any(Array),
      omitted: 5,
    });
    if (answer.kind !== 'student_list') throw new Error('unreachable');
    expect(answer.names).toHaveLength(ZALO_BOT_CHAT_MAX_LISTED_STUDENTS);
  });

  it('refuses to list another teacher class', async () => {
    const answer = await runClassStudentList(db, teacherA, {
      classId: 'c_b1',
      className: '9C1',
    });

    expect(answer).toEqual({ kind: 'class_not_found', hint: '9C1' });
    expect(rosterMocks.listCanonicalClassRosterProfiles).not.toHaveBeenCalled();
  });

  it('returns the protected class end date without another data query', async () => {
    const answer = await runClassEndDate(db, teacherA, {
      classId: 'c_a1',
      className: '7A1',
    });

    expect(answer).toEqual({
      kind: 'class_end_date',
      className: '7A1',
      endDate: '2026-12-31',
    });
    expect(rosterMocks.listCanonicalClassRoster).not.toHaveBeenCalled();
    expect(rosterMocks.listCanonicalClassRosterProfiles).not.toHaveBeenCalled();
  });

  it('refuses to reveal another teacher class end date', async () => {
    const answer = await runClassEndDate(db, teacherA, {
      classId: 'c_b1',
      className: '9C1',
    });

    expect(answer).toEqual({ kind: 'class_not_found', hint: '9C1' });
  });

  it('does not expose a malformed class end date', async () => {
    const malformed = createInMemoryDocumentStore({
      'classes/c_a1': {
        name: '7A1',
        teacherId: 'teacher_a',
        status: 'active',
        endDate: '2026-02-30',
      },
    }).db;

    const answer = await runClassEndDate(malformed as any, teacherA, {
      classId: 'c_a1',
      className: '7A1',
    });

    expect(answer).toEqual({ kind: 'class_end_date', className: '7A1', endDate: null });
  });
});

describe('runAttendanceToday', () => {
  let memory: ReturnType<typeof createInMemoryDocumentStore>;
  let db: any;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = createInMemoryDocumentStore({
      // daysOfWeek 0 = Chủ nhật; 2026-08-17 là thứ Hai (1).
      'classes/c_a1': {
        name: '7A1',
        teacherId: 'teacher_a',
        status: 'active',
        daysOfWeek: [1],
        startDate: '2026-08-01',
        endDate: '2026-12-31',
      },
      'classes/c_a2': {
        name: '7A2',
        teacherId: 'teacher_a',
        status: 'active',
        daysOfWeek: [3],
        startDate: '2026-08-01',
        endDate: '2026-12-31',
      },
      'classes/c_b1': {
        name: '9C1',
        teacherId: 'teacher_b',
        status: 'active',
        daysOfWeek: [1],
        startDate: '2026-08-01',
        endDate: '2026-12-31',
      },
      'attendance/a1': { classId: 'c_a1', studentId: 's1', date: '2026-08-17' },
    });
    db = memory.db;

    attendanceMocks.resolveAttendanceEligibilityBatch.mockResolvedValue(
      new Map([
        ['s1', { eligibility: 'eligible' }],
        ['s2', { eligibility: 'eligible' }],
        ['s3', { eligibility: 'on_leave' }],
      ])
    );
    rosterMocks.listCanonicalClassRoster.mockResolvedValue([
      { canonicalProfileId: 's1', profile: { id: 's1', name: 'A', leavePeriods: [] } },
      { canonicalProfileId: 's2', profile: { id: 's2', name: 'B', leavePeriods: [] } },
      {
        canonicalProfileId: 's3',
        profile: {
          id: 's3',
          name: 'C',
          leavePeriods: [{ classId: 'c_a1', from: '2026-08-10', until: null }],
        },
      },
    ]);
  });

  it('reports only classes scheduled today, for this teacher only', async () => {
    const answer = await runAttendanceToday(db, teacherA, '2026-08-17');

    expect(answer.kind).toBe('attendance_today');
    if (answer.kind !== 'attendance_today') throw new Error('unreachable');
    expect(answer.classes.map((row) => row.className)).toEqual(['7A1']);
  });

  it('counts eligible, marked, and missing', async () => {
    const answer = await runAttendanceToday(db, teacherA, '2026-08-17');

    if (answer.kind !== 'attendance_today') throw new Error('unreachable');
    expect(answer.classes[0]).toEqual({
      className: '7A1',
      eligible: 2,
      marked: 1,
      missing: 1,
    });
  });

  it('re-checks access and scopes every attendance query by classId plus date', async () => {
    await runAttendanceToday(db, teacherA, '2026-08-17');

    // assertClassAccess performs a direct class read after listAuthorizedClasses.
    expect(memory.readLog).toContain('classes/c_a1');
    expect(memory.readLog).not.toContain('classes/c_b1');

    const attendanceQueries = memory.queryLog.filter((row) => row.collection === 'attendance');
    expect(attendanceQueries.length).toBeGreaterThan(0);
    for (const query of attendanceQueries) {
      expect(query.filters).toEqual(
        expect.arrayContaining([
          ['classId', '==', 'c_a1'],
          ['date', '==', '2026-08-17'],
        ])
      );
    }
  });

  it('passes the full profile to eligibility instead of only id and name', async () => {
    await runAttendanceToday(db, teacherA, '2026-08-17');

    const input = attendanceMocks.resolveAttendanceEligibilityBatch.mock.calls[0][1];
    expect(input.studentsById.get('s3')).toMatchObject({
      leavePeriods: [{ classId: 'c_a1', from: '2026-08-10', until: null }],
    });
  });

  it('returns an empty list when nothing is scheduled today', async () => {
    const answer = await runAttendanceToday(db, teacherA, '2026-08-18');

    if (answer.kind !== 'attendance_today') throw new Error('unreachable');
    expect(answer.classes).toEqual([]);
  });

  it('does not report a scheduled class whose session was cancelled', async () => {
    memory.store.set('class_sessions/cancelled-c_a1', {
      classId: 'c_a1',
      date: '2026-08-17',
      status: 'cancelled',
    });

    const answer = await runAttendanceToday(db, teacherA, '2026-08-17');

    if (answer.kind !== 'attendance_today') throw new Error('unreachable');
    expect(answer.classes).toEqual([]);
    expect(rosterMocks.listCanonicalClassRoster).not.toHaveBeenCalled();
  });

  it('reports an explicit makeup session even when the class is not normally scheduled', async () => {
    memory.store.set('class_sessions/cancelled-c_a1', {
      classId: 'c_a1',
      date: '2026-08-17',
      status: 'cancelled',
    });
    memory.store.set('class_sessions/makeup-c_a2', {
      classId: 'c_a2',
      date: '2026-08-17',
      status: 'makeup',
    });

    const answer = await runAttendanceToday(db, teacherA, '2026-08-17');

    if (answer.kind !== 'attendance_today') throw new Error('unreachable');
    expect(answer.classes.map((row) => row.className)).toEqual(['7A2']);
  });
});

describe('runMyTodo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('turns the digest plan into a todo answer', async () => {
    todoMocks.collectZaloBotChatTodoSources.mockResolvedValue({
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
      activeRecipients: [
        { staffId: 'teacher_a', role: 'teacher', displayName: 'A', chatIdHash: '' },
      ],
      attendance: [
        {
          classId: 'c_a1',
          className: '7A1',
          date: '2026-08-17',
          scheduled: true,
          sessionStatus: 'unconfirmed',
          primaryTeacherId: 'teacher_a',
          effectiveTeacherId: 'teacher_a',
          eligibleStudentIds: ['s1', 's2'],
          markedStudentIds: ['s1'],
        },
      ],
      courseClosing: [],
      printRequests: [],
      sourceCounts: {
        classes: 1,
        sessions: 0,
        attendanceRows: 1,
        printRequests: 0,
        activeLinks: 1,
        eligibleRecipients: 1,
        outstandingFailedMessages: 0,
        potentialTruncation: [],
      },
    });

    const answer = await runMyTodo(createInMemoryDocumentStore({}).db as any, teacherA, '2026-08-17');

    expect(answer).toEqual({
      kind: 'my_todo',
      attendance: [{ className: '7A1', missingStudentCount: 1 }],
      courseClosing: [],
      printRequests: [],
    });
  });

  it('returns an empty todo when the plan holds nothing for the actor', async () => {
    todoMocks.collectZaloBotChatTodoSources.mockResolvedValue({
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
      activeRecipients: [
        { staffId: 'teacher_a', role: 'teacher', displayName: 'A', chatIdHash: '' },
      ],
      attendance: [],
      courseClosing: [],
      printRequests: [],
      sourceCounts: {
        classes: 0,
        sessions: 0,
        attendanceRows: 0,
        printRequests: 0,
        activeLinks: 1,
        eligibleRecipients: 1,
        outstandingFailedMessages: 0,
        potentialTruncation: [],
      },
    });

    const answer = await runMyTodo(createInMemoryDocumentStore({}).db as any, teacherA, '2026-08-17');

    expect(answer).toEqual({
      kind: 'my_todo',
      attendance: [],
      courseClosing: [],
      printRequests: [],
    });
  });

  it('keeps office print requests in the chat answer', async () => {
    const officeActor: UserContext = { uid: 'office_1', role: 'office', name: 'O' };
    todoMocks.collectZaloBotChatTodoSources.mockResolvedValue({
      digestDate: '2026-08-17',
      tomorrowDate: '2026-08-18',
      activeRecipients: [{ staffId: 'office_1', role: 'office', displayName: 'O', chatIdHash: '' }],
      attendance: [],
      courseClosing: [],
      printRequests: [
        {
          requestId: 'p1',
          className: '7A1',
          teacherName: 'Cô A',
          neededDate: '2026-08-18',
          status: 'pending',
          fileCount: 1,
          totalCopies: 20,
        },
      ],
      sourceCounts: {
        classes: 2,
        sessions: 0,
        attendanceRows: 0,
        printRequests: 1,
        activeLinks: 1,
        eligibleRecipients: 1,
        outstandingFailedMessages: 0,
        potentialTruncation: [],
      },
    });

    const answer = await runMyTodo(
      createInMemoryDocumentStore({}).db as any,
      officeActor,
      '2026-08-17'
    );

    expect(answer).toMatchObject({
      kind: 'my_todo',
      printRequests: [{ className: '7A1', totalCopies: 20 }],
    });
  });
});
