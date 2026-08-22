import { describe, expect, it, vi } from 'vitest';
import {
  closeOpenEnrollments,
  preloadStudentEnrollmentsInTransaction,
  requireSingleOpenStudentEnrollment,
  transitionSystemEnrollment,
  updateManualEnrollment,
  upsertSystemEnrollment,
} from './courseEnrollmentRepository.js';
import {
  makeStudentCourseEnrollmentId,
  type StudentCourseEnrollment,
} from '../../../../shared/studentCourseEnrollment.js';

const base = {
  termStart: '2026-07-01',
  termEnd: '2026-09-30',
  joinedAt: '2026-07-03',
  endedAt: null,
  statusReason: null,
  source: 'system' as const,
  confidence: 'confirmed' as const,
  statusChangedAt: '2026-07-03T01:00:00.000Z',
  statusChangedBy: 'admin-1',
  confirmedAt: '2026-07-03T01:00:00.000Z',
  confirmedBy: 'admin-1',
  createdAt: '2026-07-03T01:00:00.000Z',
  updatedAt: '2026-07-03T01:00:00.000Z',
};

function enrollment(
  studentId: string,
  classId: string,
  status: StudentCourseEnrollment['status'] = 'active',
  overrides: Partial<StudentCourseEnrollment> = {}
): StudentCourseEnrollment {
  return {
    ...base,
    id: makeStudentCourseEnrollmentId(studentId, classId, base.termStart),
    studentId,
    classId,
    status,
    endedAt: ['trial', 'active', 'on_leave'].includes(status) ? null : '2026-07-30',
    ...overrides,
  };
}

function makeDb(records: StudentCourseEnrollment[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const collection = {
    doc: vi.fn((id: string) => ({
      id,
      get: vi.fn(async () => {
        const data = byId.get(id);
        return { id, exists: Boolean(data), data: () => data || {} };
      }),
    })),
    where: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        get: vi.fn(async () => ({
          docs: [...byId.values()].map((data) => ({ id: data.id, exists: true, data: () => data })),
        })),
      })),
    })),
  };
  const db = { collection: vi.fn(() => collection) } as any;
  const tx = {
    get: vi.fn(async (target: any) => target.get()),
    update: vi.fn(),
    create: vi.fn(),
  } as any;
  return { db, tx, collection };
}

describe('course enrollment repository', () => {
  it('requires exactly one open enrollment as the progression source', () => {
    const openEnrollment = enrollment('stu-1', 'class-source');
    const openA = enrollment('stu-1', 'class-a');
    const openB = enrollment('stu-1', 'class-b');

    expect(requireSingleOpenStudentEnrollment([openEnrollment]).id).toBe(openEnrollment.id);
    expect(() => requireSingleOpenStudentEnrollment([])).toThrow(/open enrollment/i);
    expect(() => requireSingleOpenStudentEnrollment([openA, openB])).toThrow(/multiple/i);
  });

  it('marks an ineligible progression source as a conflict', () => {
    const openA = enrollment('stu-1', 'class-a');
    const openB = enrollment('stu-1', 'class-b');

    for (const enrollments of [[], [openA, openB]]) {
      try {
        requireSingleOpenStudentEnrollment(enrollments);
        throw new Error('Expected an ineligible source error');
      } catch (error) {
        expect(error).toMatchObject({ statusCode: 409 });
        expect(error).toHaveProperty('message', expect.stringContaining('STUDENT_PROGRESSION_SOURCE_INELIGIBLE'));
      }
    }
  });

  it('never closes an enrollment before the day it started', async () => {
    const open = enrollment('stu-1', 'class-old', 'active', { joinedAt: '2026-07-20' });
    const { db, tx } = makeDb([open]);

    await upsertSystemEnrollment(tx, db, {
      studentId: 'stu-1',
      classId: 'class-new',
      termStart: '2026-01-05',
      termEnd: '2026-03-31',
      status: 'active',
      joinedAt: '2026-02-10',
      actorId: 'admin-1',
      now: '2026-07-28T01:00:00.000Z',
    });

    const closed = tx.update.mock.calls.find(([ref]) => ref.id === open.id)?.[1];
    expect(closed).toMatchObject({ status: 'transferred', endedAt: '2026-07-20' });
  });

  it('closes an existing open enrollment when a new system enrollment is created', async () => {
    const old = enrollment('stu-1', 'class-old');
    const { db, tx } = makeDb([old]);

    const created = await upsertSystemEnrollment(tx, db, {
      studentId: 'stu-1',
      classId: 'class-new',
      termStart: '2026-07-01',
      termEnd: '2026-09-30',
      status: 'active',
      joinedAt: '2026-07-10',
      actorId: 'admin-1',
      now: '2026-07-10T01:00:00.000Z',
    });

    expect(created.classId).toBe('class-new');
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: old.id }),
      expect.objectContaining({ status: 'transferred', endedAt: '2026-07-10' })
    );
    expect(tx.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      expect.objectContaining({ classId: 'class-new', status: 'active' })
    );
  });

  it('updates the same tuple on a retry instead of creating a duplicate', async () => {
    const existing = enrollment('stu-1', 'class-1', 'on_leave', {
      source: 'backfill',
      confidence: 'inferred',
      confirmedAt: null,
      confirmedBy: null,
    });
    const { db, tx } = makeDb([existing]);

    const result = await upsertSystemEnrollment(tx, db, {
      studentId: 'stu-1',
      classId: 'class-1',
      termStart: existing.termStart,
      termEnd: existing.termEnd,
      status: 'active',
      joinedAt: existing.joinedAt,
      actorId: 'admin-1',
      now: '2026-07-11T01:00:00.000Z',
    });

    expect(result.id).toBe(existing.id);
    expect(tx.create).not.toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: existing.id }),
      expect.objectContaining({ status: 'active', confidence: 'confirmed' })
    );
  });

  it('does not overwrite an inferred backfill record already confirmed by a human', async () => {
    const existing = enrollment('stu-1', 'class-1', 'on_leave', {
      source: 'backfill',
      confidence: 'confirmed',
      confirmedAt: '2026-07-09T01:00:00.000Z',
      confirmedBy: 'office-1',
    });
    const { db, tx } = makeDb([existing]);

    const result = await upsertSystemEnrollment(tx, db, {
      studentId: 'stu-1',
      classId: 'class-1',
      termStart: existing.termStart,
      termEnd: existing.termEnd,
      status: 'active',
      joinedAt: existing.joinedAt,
      actorId: 'system',
      now: '2026-07-11T01:00:00.000Z',
    });

    expect(result).toEqual(existing);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('transitions the real system trial enrollment to active when trial acceptance expects trial', async () => {
    const existing = enrollment('stu-1', 'class-1', 'trial');
    const { db, tx } = makeDb([existing]);
    const preloaded = await preloadStudentEnrollmentsInTransaction(tx, db, 'stu-1', existing.id);
    tx.get.mockClear();

    const result = await transitionSystemEnrollment(
      tx,
      db,
      {
        studentId: 'stu-1',
        classId: 'class-1',
        termStart: existing.termStart,
        termEnd: existing.termEnd,
        status: 'active',
        joinedAt: existing.joinedAt,
        actorId: 'teacher-1',
        now: '2026-07-11T01:00:00.000Z',
        expectedStatuses: ['trial'],
        statusReason: 'trial_accepted',
      },
      preloaded
    );

    expect(result).toMatchObject({ id: existing.id, status: 'active', endedAt: null });
    expect(tx.get).not.toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: existing.id }),
      expect.objectContaining({ status: 'active', statusReason: 'trial_accepted' })
    );
  });

  it('transitions a closed system enrollment back to trial only from an expected closed state', async () => {
    const existing = enrollment('stu-1', 'class-1', 'dropped');
    const { db, tx } = makeDb([existing]);
    const preloaded = await preloadStudentEnrollmentsInTransaction(tx, db, 'stu-1', existing.id);
    tx.get.mockClear();

    const result = await transitionSystemEnrollment(
      tx,
      db,
      {
        studentId: 'stu-1',
        classId: 'class-1',
        termStart: existing.termStart,
        termEnd: existing.termEnd,
        status: 'trial',
        joinedAt: '2026-07-20',
        actorId: 'office-1',
        now: '2026-07-20T01:00:00.000Z',
        expectedStatuses: ['completed', 'transferred', 'dropped'],
        statusReason: 'trial_reactivated',
      },
      preloaded
    );

    expect(result).toMatchObject({ id: existing.id, status: 'trial', endedAt: null });
    expect(tx.get).not.toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: existing.id }),
      expect.objectContaining({ status: 'trial', statusReason: 'trial_reactivated' })
    );
  });

  it.each([
    { source: 'manual' as const, confidence: 'confirmed' as const },
    { source: 'backfill' as const, confidence: 'confirmed' as const },
  ])('rejects a protected $source enrollment instead of fabricating a system transition', async (ownership) => {
    const existing = enrollment('stu-1', 'class-1', 'dropped', ownership);
    const { db, tx } = makeDb([existing]);
    const preloaded = await preloadStudentEnrollmentsInTransaction(tx, db, 'stu-1', existing.id);
    tx.get.mockClear();

    await expect(
      transitionSystemEnrollment(
        tx,
        db,
        {
          studentId: 'stu-1',
          classId: 'class-1',
          termStart: existing.termStart,
          termEnd: existing.termEnd,
          status: 'trial',
          joinedAt: '2026-07-20',
          actorId: 'office-1',
          now: '2026-07-20T01:00:00.000Z',
          expectedStatuses: ['completed', 'transferred', 'dropped'],
          statusReason: 'trial_reactivated',
        },
        preloaded
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.get).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('rejects a manual correction that would create a second open enrollment', async () => {
    const current = enrollment('stu-1', 'class-1');
    const other = enrollment('stu-1', 'class-2');
    const { db, tx } = makeDb([current, other]);

    await expect(
      updateManualEnrollment(tx, db, {
        enrollmentId: current.id,
        status: 'active',
        joinedAt: current.joinedAt,
        endedAt: null,
        statusReason: 'confirm',
        actorId: 'office-1',
        now: '2026-07-12T01:00:00.000Z',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('closes all open records except the target when explicitly requested', async () => {
    const first = enrollment('stu-1', 'class-1');
    const second = enrollment('stu-1', 'class-2');
    const { db, tx } = makeDb([first, second]);

    const closed = await closeOpenEnrollments(tx, db, {
      studentId: 'stu-1',
      exceptEnrollmentId: second.id,
      status: 'dropped',
      endedAt: '2026-07-12',
      reason: 'archive',
      actorId: 'admin-1',
      now: '2026-07-12T01:00:00.000Z',
    });

    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ id: first.id, status: 'dropped' });
    expect(tx.update).toHaveBeenCalledTimes(1);
  });
});

/**
 * Progression has to read the whole enrollment picture before it decides
 * anything, because eligibility depends on what is open *anywhere*, not only in
 * the source class. A helper that read lazily would put those reads after the
 * first write and make the decision unserializable.
 */
describe('enrollment preloading', () => {
  it('returns every enrollment, the target tuple, and the single open record', async () => {
    const open = enrollment('stu-1', 'class-1');
    const done = enrollment('stu-1', 'class-0', 'completed', { endedAt: '2026-07-20' });
    const { db, tx } = makeDb([open, done]);

    const preloaded = await preloadStudentEnrollmentsInTransaction(tx, db, 'stu-1', open.id);

    expect(preloaded.all.map((record) => record.id).sort()).toEqual([done.id, open.id].sort());
    expect(preloaded.existing?.id).toBe(open.id);
    expect(preloaded.open?.id).toBe(open.id);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('reports no open enrollment when every record is closed', async () => {
    const done = enrollment('stu-1', 'class-0', 'completed', { endedAt: '2026-07-20' });
    const { db, tx } = makeDb([done]);

    const preloaded = await preloadStudentEnrollmentsInTransaction(tx, db, 'stu-1', 'not-there');

    expect(preloaded.open).toBeNull();
    expect(preloaded.existing).toBeNull();
  });

  it('refuses to report a single open record when two are open', async () => {
    // Two opens is a data fault, not a state a caller should get to average
    // over. Returning one of them would let progression close the wrong course.
    const first = enrollment('stu-1', 'class-1');
    const second = enrollment('stu-1', 'class-2');
    const { db, tx } = makeDb([first, second]);

    await expect(
      preloadStudentEnrollmentsInTransaction(tx, db, 'stu-1', first.id)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('accepts a preloaded set and stages writes without reading again', async () => {
    const old = enrollment('stu-1', 'class-old');
    const { db, tx } = makeDb([old]);
    const preloaded = await preloadStudentEnrollmentsInTransaction(tx, db, 'stu-1', 'target');
    tx.get.mockClear();

    await upsertSystemEnrollment(
      tx,
      db,
      {
        studentId: 'stu-1',
        classId: 'class-new',
        termStart: '2026-07-01',
        termEnd: '2026-09-30',
        status: 'active',
        joinedAt: '2026-07-10',
        actorId: 'admin-1',
        now: '2026-07-10T01:00:00.000Z',
      },
      preloaded
    );

    expect(tx.get).not.toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: old.id }),
      expect.objectContaining({ status: 'transferred' })
    );
  });

  it('closes open enrollments from a preloaded set without reading again', async () => {
    const first = enrollment('stu-1', 'class-1');
    const { db, tx } = makeDb([first]);
    const preloaded = await preloadStudentEnrollmentsInTransaction(tx, db, 'stu-1', 'target');
    tx.get.mockClear();

    const closed = await closeOpenEnrollments(
      tx,
      db,
      {
        studentId: 'stu-1',
        status: 'completed',
        endedAt: '2026-07-12',
        reason: 'course_completed',
        actorId: 'admin-1',
        now: '2026-07-12T01:00:00.000Z',
      },
      preloaded
    );

    expect(tx.get).not.toHaveBeenCalled();
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ id: first.id, status: 'completed' });
  });
});
