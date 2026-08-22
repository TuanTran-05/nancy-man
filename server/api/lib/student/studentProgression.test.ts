import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeStudentProgressionIdempotencyKey,
  progressStudentToClass,
  STUDENT_PROGRESSION_EVENTS_COLLECTION,
} from './studentProgression.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import { resetCanonicalStudentReadControlCacheForTests } from './canonicalStudentReadControl.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
    delete: vi.fn(() => ({ __op: 'deleteField' })),
  },
}));

const NOW = '2026-08-08T01:00:00.000Z';

const ENROLLMENT_BASE = {
  termEnd: '2026-06-30',
  endedAt: null as string | null,
  statusReason: null as string | null,
  source: 'system' as const,
  confidence: 'confirmed' as const,
  statusChangedAt: '2026-01-05T00:00:00.000Z',
  statusChangedBy: 'admin-1',
  confirmedAt: '2026-01-05T00:00:00.000Z',
  confirmedBy: 'admin-1',
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-01-05T00:00:00.000Z',
};

function enrollmentDoc(
  classId: string,
  termStart: string,
  status: string,
  overrides: Record<string, unknown> = {}
) {
  const id = makeStudentCourseEnrollmentId('profile-1', classId, termStart);
  return {
    id,
    data: {
      ...ENROLLMENT_BASE,
      id,
      studentId: 'profile-1',
      classId,
      termStart,
      joinedAt: termStart,
      status,
      ...(['completed', 'transferred', 'dropped'].includes(status)
        ? { endedAt: '2026-06-30' }
        : {}),
      ...overrides,
    } as Record<string, unknown>,
  };
}

const SOURCE = enrollmentDoc('class-source', '2026-01-05', 'active');

/**
 * Progression is the operation the whole workstream exists to make safe: it is
 * where a student used to be cloned into a new profile. The harness therefore
 * records every write with its path, so a test can assert not only what changed
 * but that no second `students` document was ever created.
 */
function makeHarness(
  options: {
    enrollments?: Array<{ id: string; data: Record<string, unknown> }>;
    event?: Record<string, unknown>;
    profile?: Record<string, unknown> | null;
    sourceClass?: Record<string, unknown> | null;
    targetClass?: Record<string, unknown> | null;
    sourceLedgers?: Array<{ id: string; data: Record<string, unknown> }>;
    targetLedgers?: Array<{ id: string; data: Record<string, unknown> }>;
    pendingPayments?: Array<{ id: string; data: Record<string, unknown> }>;
    linkedUsers?: string[];
    maintenance?: Record<string, unknown>;
    readModel?: Record<string, unknown>;
    transactionReadModel?: Record<string, unknown>;
  } = {}
) {
  const profile = options.profile === undefined
    ? {
        name: 'Quách Hoàng Minh',
        classId: 'class-source',
        teacherId: 'teacher-1',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      }
    : options.profile;
  const sourceClass = options.sourceClass === undefined ? { teacherId: 'teacher-1' } : options.sourceClass;
  const targetClass =
    options.targetClass === undefined
      ? {
          teacherId: 'teacher-2',
          name: 'Target Class',
          tuitionFee: 2_000_000,
          startDate: '2026-07-01',
          endDate: '2026-12-31',
        }
      : options.targetClass;
  const enrollments = options.enrollments ?? [SOURCE];
  const linkedUsers = options.linkedUsers ?? ['student:profile-1', 'parent:profile-1'];

  const writes: Array<{ op: string; path: string; data: Record<string, unknown> }> = [];
  const reads: string[] = [];
  // One combined log, because "all reads before all writes" is a property of
  // the interleaving and cannot be checked from two separate lists.
  const order: string[] = [];

  function snapshotOf(path: string) {
    if (path === '_maintenance/student_identity') {
      return { exists: options.maintenance !== undefined, data: () => options.maintenance };
    }
    if (path === '_maintenance/student_identity_read_model') {
      return { exists: options.readModel !== undefined, data: () => options.readModel };
    }
    if (path.startsWith('student_profile_aliases/')) return { exists: false, data: () => undefined };
    if (path.startsWith('student_code_registry/')) return { exists: false, data: () => undefined };
    if (path.startsWith(`${STUDENT_PROGRESSION_EVENTS_COLLECTION}/`)) {
      return { exists: options.event !== undefined, data: () => options.event };
    }
    if (path === 'students/profile-1') return { exists: profile !== null, data: () => profile };
    if (path === 'classes/class-source') {
      return { exists: sourceClass !== null, data: () => sourceClass };
    }
    if (path === 'classes/class-target') {
      return { exists: targetClass !== null, data: () => targetClass };
    }
    if (path.startsWith('users/')) {
      return { exists: linkedUsers.includes(path.slice('users/'.length)), data: () => ({}) };
    }
    const found = enrollments.find((row) => path === `student_course_enrollments/${row.id}`);
    if (found) return { id: found.id, exists: true, data: () => found.data };
    return { exists: false, data: () => undefined };
  }

  function makeQuery(collection: string) {
    const filters: Array<[string, string, unknown]> = [];
    const query: Record<string, unknown> = {};
    Object.assign(query, {
      __collection: collection,
      __filters: filters,
      where(field: string, op: string, value: unknown) {
        filters.push([field, op, value]);
        return query;
      },
      orderBy: () => query,
      limit: () => query,
      get() {
        const rows =
          collection === 'student_course_enrollments'
            ? enrollments
            : collection === 'course_fee_ledgers'
              ? [...(options.sourceLedgers ?? []), ...(options.targetLedgers ?? [])]
              : collection === 'payment_requests'
                ? (options.pendingPayments ?? [])
                : [];
        const docs = rows.filter((row) =>
          filters.every(([field, op, value]) =>
            op === '==' ? row.data[field] === value : true
          )
        );
        return {
          empty: docs.length === 0,
          docs: docs.map((row) => ({
            id: row.id,
            exists: true,
            ref: { path: `${collection}/${row.id}` },
            data: () => row.data,
          })),
        };
      },
    });
    return query;
  }

  const db = {
    // `get` matters: the read-model control is read outside the transaction,
    // and a ref without it would make the control fail closed to
    // legacy_compare and quietly mask what these tests are asserting.
    doc: (path: string) => ({
      path,
      id: path.split('/').pop(),
      get: async () => snapshotOf(path),
    }),
    collection(name: string) {
      const query = makeQuery(name);
      return {
        ...query,
        doc: (id?: string) => ({ path: `${name}/${id ?? 'auto'}`, id: id ?? 'auto' }),
      };
    },
    async runTransaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      return callback(tx);
    },
  };

  const stage = (op: string) => (ref: { path: string }, data: Record<string, unknown>) => {
    writes.push({ op, path: ref.path, data });
    order.push(`write:${ref.path}`);
  };

  const tx = {
    async get(target: { path?: string; __filters?: unknown; get?: () => unknown }) {
      if (target.__filters) {
        const label = `query:${(target as { __collection: string }).__collection}`;
        reads.push(label);
        order.push(`read:${label}`);
        return (target.get as () => unknown)();
      }
      reads.push(target.path!);
      order.push(`read:${target.path!}`);
      if (
        target.path === '_maintenance/student_identity_read_model' &&
        options.transactionReadModel !== undefined
      ) {
        return { exists: true, data: () => options.transactionReadModel };
      }
      return snapshotOf(target.path!);
    },
    create: stage('create'),
    set: stage('set'),
    update: stage('update'),
  };

  return { db: db as never, writes, reads, order };
}

const INPUT = {
  profileId: 'profile-1',
  sourceClassId: 'class-source',
  targetClassId: 'class-target',
  targetTermStart: '2026-07-01',
  requestedJoinedAt: '2026-07-01',
  kind: 'course_completion' as const,
  actorId: 'office-1',
  mutationOperation: 'classes:import-students' as const,
  now: NOW,
};

function writesTo(
  writes: Array<{ path: string; data: Record<string, unknown> }>,
  prefix: string
) {
  return writes.filter((write) => write.path.startsWith(prefix));
}

describe('progression identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The control cache is monotonic by design -- it never rolls back to a
    // weaker mode within a process. Tests exercise several modes, so each one
    // starts from a fresh process view.
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('keeps the same profile document and never creates a second one', async () => {
    const harness = makeHarness();

    const result = await progressStudentToClass(harness.db, INPUT);

    expect(result.profileId).toBe('profile-1');
    expect(writesTo(harness.writes, 'students/')).toEqual([
      expect.objectContaining({ op: 'update', path: 'students/profile-1' }),
    ]);
  });

  it('builds a deterministic idempotency key from the transition, not the clock', async () => {
    expect(makeStudentProgressionIdempotencyKey(INPUT)).toBe(
      'promotion:class-source:class-target:profile-1:2026-07-01'
    );
    // The key is derived from the transition alone; the signature does not
    // even accept the clock, so a retry an hour later lands on the same event.
    expect(
      makeStudentProgressionIdempotencyKey({
        profileId: INPUT.profileId,
        sourceClassId: INPUT.sourceClassId,
        targetClassId: INPUT.targetClassId,
        targetTermStart: INPUT.targetTermStart,
      })
    ).toBe(makeStudentProgressionIdempotencyKey(INPUT));
  });

  it('replays an existing event without writing anything', async () => {
    const key = makeStudentProgressionIdempotencyKey(INPUT);
    const harness = makeHarness({
      event: {
        idempotencyKey: key,
        profileId: 'profile-1',
        sourceEnrollmentId: SOURCE.id,
        targetEnrollmentId: 'target-enrollment',
        targetLedgerId: 'ledger-1',
        sourceStatusBefore: 'active',
        sourceStatusAfter: 'completed',
        rolloverBalance: 0,
        targetLedgerCreated: true,
        affectedClassIds: ['class-source', 'class-target'],
      },
      // Lifecycle has moved on since the original run; the replay must not care.
      enrollments: [enrollmentDoc('class-source', '2026-01-05', 'dropped')],
    });

    const result = await progressStudentToClass(harness.db, INPUT);

    expect(result).toMatchObject({ replayed: true, targetEnrollmentId: 'target-enrollment' });
    expect(harness.writes).toEqual([]);
  });
});

describe('progression eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The control cache is monotonic by design -- it never rolls back to a
    // weaker mode within a process. Tests exercise several modes, so each one
    // starts from a fresh process view.
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('closes an open source as transferred for a class transfer', async () => {
    const harness = makeHarness();

    const result = await progressStudentToClass(harness.db, { ...INPUT, kind: 'class_transfer' });

    expect(result).toMatchObject({
      sourceStatusBefore: 'active',
      sourceStatusAfter: 'transferred',
      sourceEnrollmentId: SOURCE.id,
    });
    const sourceWrite = harness.writes.find(
      (write) => write.path === `student_course_enrollments/${SOURCE.id}`
    );
    expect(sourceWrite?.data).toMatchObject({ status: 'transferred', endedAt: '2026-07-01' });
  });

  it('closes an open source as completed for a course completion', async () => {
    const harness = makeHarness();

    const result = await progressStudentToClass(harness.db, INPUT);

    expect(result).toMatchObject({ sourceStatusAfter: 'completed' });
    const sourceWrite = harness.writes.find(
      (write) => write.path === `student_course_enrollments/${SOURCE.id}`
    );
    expect(sourceWrite?.data).toMatchObject({ status: 'completed' });
  });

  it('accepts the exact latest completed source when the class already closed', async () => {
    const harness = makeHarness({
      enrollments: [enrollmentDoc('class-source', '2026-01-05', 'completed')],
    });

    const result = await progressStudentToClass(harness.db, INPUT);

    expect(result).toMatchObject({ sourceStatusBefore: 'completed', sourceStatusAfter: 'completed' });
    // Already closed: nothing to write on the source record.
    expect(
      harness.writes.find((write) => write.path === `student_course_enrollments/${SOURCE.id}`)
    ).toBeUndefined();
  });

  it('refuses a completed source that is not the latest record', async () => {
    // A later record means the student went somewhere after this course. Opening
    // the target from here would rewind their history.
    const harness = makeHarness({
      enrollments: [
        enrollmentDoc('class-source', '2026-01-05', 'completed'),
        enrollmentDoc('class-later', '2026-04-01', 'dropped'),
      ],
    });

    await expect(progressStudentToClass(harness.db, INPUT)).rejects.toThrow(
      'STUDENT_PROGRESSION_SOURCE_INELIGIBLE'
    );
    expect(harness.writes).toEqual([]);
  });

  it('refuses when the one open enrollment belongs to another class', async () => {
    const harness = makeHarness({
      enrollments: [enrollmentDoc('class-elsewhere', '2026-04-01', 'active')],
    });

    await expect(progressStudentToClass(harness.db, INPUT)).rejects.toThrow(
      'STUDENT_PROGRESSION_SOURCE_INELIGIBLE'
    );
    expect(harness.writes).toEqual([]);
  });

  it('refuses a dropped source', async () => {
    const harness = makeHarness({
      enrollments: [enrollmentDoc('class-source', '2026-01-05', 'dropped')],
    });

    await expect(progressStudentToClass(harness.db, INPUT)).rejects.toThrow(
      'STUDENT_PROGRESSION_SOURCE_INELIGIBLE'
    );
  });

  it('refuses to progress into the class the student is already in', async () => {
    const harness = makeHarness();

    await expect(
      progressStudentToClass(harness.db, { ...INPUT, targetClassId: 'class-source' })
    ).rejects.toThrow('STUDENT_PROGRESSION_SAME_CLASS');
  });
});

describe('progression side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The control cache is monotonic by design -- it never rolls back to a
    // weaker mode within a process. Tests exercise several modes, so each one
    // starts from a fresh process view.
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('opens the target enrollment and points the profile projection at it', async () => {
    const harness = makeHarness();

    const result = await progressStudentToClass(harness.db, INPUT);

    const targetWrite = harness.writes.find(
      (write) => write.path === `student_course_enrollments/${result.targetEnrollmentId}`
    );
    expect(targetWrite?.data).toMatchObject({
      classId: 'class-target',
      termStart: '2026-07-01',
      status: 'active',
      joinedAt: '2026-07-01',
    });
    const profileWrite = harness.writes.find((write) => write.path === 'students/profile-1');
    expect(profileWrite?.data).toMatchObject({
      classId: 'class-target',
      teacherId: 'teacher-2',
      enrollmentStatus: 'active',
      currentEnrollmentId: result.targetEnrollmentId,
    });
  });

  it('projects the same class and teacher onto both linked user documents', async () => {
    const harness = makeHarness();

    await progressStudentToClass(harness.db, INPUT);

    for (const path of ['users/student:profile-1', 'users/parent:profile-1']) {
      expect(harness.writes.find((write) => write.path === path)?.data).toMatchObject({
        studentId: 'profile-1',
        classId: 'class-target',
        teacherId: 'teacher-2',
      });
    }
  });

  it('moves the class headcount off the source and onto the target', async () => {
    const harness = makeHarness();

    const result = await progressStudentToClass(harness.db, INPUT);

    expect(result.affectedClassIds.sort()).toEqual(['class-source', 'class-target']);
    expect(harness.writes.find((write) => write.path === 'classes/class-source')?.data).toMatchObject(
      { 'studentCounts.total': 'increment:-1' }
    );
    expect(harness.writes.find((write) => write.path === 'classes/class-target')?.data).toMatchObject(
      { 'studentCounts.total': 'increment:1' }
    );
  });

  it('rolls a source credit into a discount on the new ledger', async () => {
    const harness = makeHarness({
      sourceLedgers: [
        {
          id: 'ledger-source',
          data: {
            studentId: 'profile-1',
            classId: 'class-source',
            termStart: '2026-01-05',
            amount: 1_000_000,
            paidTotal: 1_500_000,
            discountTotal: 0,
          },
        },
      ],
    });

    const result = await progressStudentToClass(harness.db, INPUT);

    expect(result).toMatchObject({ rolloverBalance: 500_000, targetLedgerCreated: true });
    const ledgerWrite = harness.writes.find((write) => write.path.startsWith('course_fee_ledgers/'));
    expect(ledgerWrite?.data).toMatchObject({
      amount: 2_000_000,
      discountTotal: 500_000,
      rolloverFromLedgerId: 'ledger-source',
      rolloverBalance: 500_000,
    });
    expect(Number.isInteger(result.rolloverBalance)).toBe(true);
  });

  it('adds a source debt to the new ledger amount instead of discounting it', async () => {
    const harness = makeHarness({
      sourceLedgers: [
        {
          id: 'ledger-source',
          data: {
            studentId: 'profile-1',
            classId: 'class-source',
            termStart: '2026-01-05',
            amount: 1_000_000,
            paidTotal: 400_000,
            discountTotal: 0,
          },
        },
      ],
    });

    const result = await progressStudentToClass(harness.db, INPUT);

    expect(result.rolloverBalance).toBe(-600_000);
    const ledgerWrite = harness.writes.find((write) => write.path.startsWith('course_fee_ledgers/'));
    expect(ledgerWrite?.data).toMatchObject({ amount: 2_600_000, discountTotal: 0 });
  });

  it('creates no second ledger when one already exists for the target tuple', async () => {
    const harness = makeHarness({
      targetLedgers: [
        {
          id: 'ledger-target',
          data: { studentId: 'profile-1', classId: 'class-target', termStart: '2026-07-01' },
        },
      ],
    });

    const result = await progressStudentToClass(harness.db, INPUT);

    expect(result.targetLedgerCreated).toBe(false);
    expect(writesTo(harness.writes, 'course_fee_ledgers/')).toEqual([]);
  });

  it('voids a pending payment request that belonged to the source course', async () => {
    const harness = makeHarness({
      pendingPayments: [
        {
          id: 'pay-1',
          data: { studentId: 'profile-1', classId: 'class-source', status: 'pending' },
        },
      ],
    });

    await progressStudentToClass(harness.db, INPUT);

    expect(harness.writes.find((write) => write.path === 'payment_requests/pay-1')?.data).toMatchObject(
      { status: 'void' }
    );
  });

  it('records the progression event under its idempotency key', async () => {
    const harness = makeHarness();
    const key = makeStudentProgressionIdempotencyKey(INPUT);

    const result = await progressStudentToClass(harness.db, INPUT);

    const event = harness.writes.find((write) =>
      write.path.startsWith(`${STUDENT_PROGRESSION_EVENTS_COLLECTION}/`)
    );
    expect(event?.path).toBe(`${STUDENT_PROGRESSION_EVENTS_COLLECTION}/${key}`);
    expect(event?.data).toMatchObject({
      idempotencyKey: key,
      profileId: 'profile-1',
      kind: 'course_completion',
      actorId: 'office-1',
      targetEnrollmentId: result.targetEnrollmentId,
    });
    expect(result.replayed).toBe(false);
  });
});

describe('progression refuses before writing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The control cache is monotonic by design -- it never rolls back to a
    // weaker mode within a process. Tests exercise several modes, so each one
    // starts from a fresh process view.
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('reads every decision input before the first write', async () => {
    const harness = makeHarness();

    await progressStudentToClass(harness.db, INPUT);

    // Maintenance leads: a mode flip mid-transaction has to force a retry
    // rather than slip through on a view taken beside the transaction.
    expect(harness.reads[0]).toBe('_maintenance/student_identity');
    expect(harness.reads).toContain(
      `${STUDENT_PROGRESSION_EVENTS_COLLECTION}/${makeStudentProgressionIdempotencyKey(INPUT)}`
    );
    expect(harness.reads).toContain('students/profile-1');
    expect(harness.reads).toContain('classes/class-target');
  });

  it('performs no read after the first write', async () => {
    // DocumentStore forbids it, and more importantly a decision made from data read
    // after a staged write was never serialized against that write.
    const harness = makeHarness({
      sourceLedgers: [
        {
          id: 'ledger-source',
          data: {
            studentId: 'profile-1',
            classId: 'class-source',
            termStart: '2026-01-05',
            amount: 1_000_000,
            paidTotal: 1_000_000,
            discountTotal: 0,
          },
        },
      ],
      pendingPayments: [
        { id: 'pay-1', data: { studentId: 'profile-1', classId: 'class-source', status: 'pending' } },
      ],
    });

    await progressStudentToClass(harness.db, INPUT);

    const firstWrite = harness.order.findIndex((entry) => entry.startsWith('write:'));
    expect(firstWrite).toBeGreaterThan(0);
    expect(harness.order.slice(firstWrite).some((entry) => entry.startsWith('read:'))).toBe(false);
  });

  it('resolves the canonical id through the transaction, not the database', async () => {
    // The database-only resolver would decide against a snapshot this
    // transaction never validated, so an alias written concurrently by the
    // merge engine could be missed exactly when it matters most.
    const harness = makeHarness();

    await progressStudentToClass(harness.db, INPUT);

    expect(harness.reads).toContain('student_profile_aliases/profile-1');
    const aliasRead = harness.order.indexOf('read:student_profile_aliases/profile-1');
    const firstWrite = harness.order.findIndex((entry) => entry.startsWith('write:'));
    expect(aliasRead).toBeGreaterThanOrEqual(0);
    expect(aliasRead).toBeLessThan(firstWrite);
  });

  it('writes nothing while identity maintenance is read_only', async () => {
    const harness = makeHarness({
      maintenance: { mode: 'read_only', activeRunId: 'run-1', migrationActorId: 'merge-bot' },
    });

    await expect(progressStudentToClass(harness.db, INPUT)).rejects.toThrow(
      'classes:import-students is blocked'
    );
    expect(harness.writes).toEqual([]);
  });

  it('deletes stale relationship projections from the profile and linked users in canonical_required', async () => {
    // classId/teacherId/enrollmentStatus on the profile are compatibility
    // projections of the enrollment. In canonical_required the enrollment is
    // the only answer, so writing them again would recreate exactly the drift
    // this program removes. currentEnrollmentId stays: it is a service-managed
    // pointer at the canonical record, not a competing source of truth.
    const harness = makeHarness({
      profile: {
        name: 'Canonical Student',
        classId: 'stale-profile-class',
        teacherId: 'stale-profile-teacher',
        enrollmentStatus: 'on_leave',
        studentLifecycle: 'enrolled',
      },
      readModel: {
        schemaVersion: 1,
        mode: 'canonical_required',
        generation: 9,
        activatedAt: '2026-08-08T00:00:00.000Z',
        activatedBy: 'admin:tt',
      },
    });

    const result = await progressStudentToClass(harness.db, INPUT);

    const profileWrite = harness.writes.find((write) => write.path === 'students/profile-1');
    expect(profileWrite?.data).toMatchObject({
      classId: { __op: 'deleteField' },
      teacherId: { __op: 'deleteField' },
      enrollmentStatus: { __op: 'deleteField' },
      currentEnrollmentId: result.targetEnrollmentId,
    });
    for (const path of ['users/student:profile-1', 'users/parent:profile-1']) {
      expect(harness.writes.find((write) => write.path === path)?.data).toMatchObject({
        classId: { __op: 'deleteField' },
        teacherId: { __op: 'deleteField' },
        enrollmentStatus: { __op: 'deleteField' },
      });
    }
  });

  it('recomputes projection policy inside a retried transaction after canonical cutover', async () => {
    const harness = makeHarness({
      profile: {
        name: 'Canonical Student',
        classId: 'stale-profile-class',
        teacherId: 'stale-profile-teacher',
        enrollmentStatus: 'active',
        studentLifecycle: 'enrolled',
      },
      readModel: {
        schemaVersion: 1,
        mode: 'legacy_compare',
        generation: 1,
        activatedAt: '2026-08-08T00:00:00.000Z',
        activatedBy: 'admin:tt',
      },
      transactionReadModel: {
        schemaVersion: 1,
        mode: 'canonical_required',
        generation: 2,
        activatedAt: '2026-08-08T00:01:00.000Z',
        activatedBy: 'admin:tt',
      },
    });

    await progressStudentToClass(harness.db, INPUT);

    expect(harness.reads).toContain('_maintenance/student_identity_read_model');
    expect(harness.writes.find((write) => write.path === 'students/profile-1')?.data).toMatchObject({
      classId: { __op: 'deleteField' },
      teacherId: { __op: 'deleteField' },
      enrollmentStatus: { __op: 'deleteField' },
    });
  });

  it('moves counters by canonical enrollments when the canonical-required profile is clean', async () => {
    const harness = makeHarness({
      profile: {
        name: 'Canonical Student',
        studentLifecycle: 'enrolled',
      },
      readModel: {
        schemaVersion: 1,
        mode: 'canonical_required',
        generation: 9,
        activatedAt: '2026-08-08T00:00:00.000Z',
        activatedBy: 'admin:tt',
      },
    });

    await progressStudentToClass(harness.db, INPUT);

    expect(harness.writes.find((write) => write.path === 'classes/class-source')?.data).toMatchObject(
      { 'studentCounts.total': 'increment:-1' }
    );
    expect(harness.writes.find((write) => write.path === 'classes/class-target')?.data).toMatchObject(
      { 'studentCounts.total': 'increment:1' }
    );
  });

  it.each(['legacy_compare', 'canonical_preferred'])(
    'still writes the legacy profile projections in %s',
    async (mode) => {
      const harness = makeHarness({
        readModel: {
          schemaVersion: 1,
          mode,
          generation: 2,
          activatedAt: '2026-08-08T00:00:00.000Z',
          activatedBy: 'admin:tt',
        },
      });

      await progressStudentToClass(harness.db, INPUT);

      expect(harness.writes.find((write) => write.path === 'students/profile-1')?.data).toMatchObject(
        {
          classId: 'class-target',
          teacherId: 'teacher-2',
          enrollmentStatus: 'active',
        }
      );
    }
  );

  it('writes nothing when the target class is archived', async () => {
    const harness = makeHarness({
      targetClass: { teacherId: 'teacher-2', status: 'archived', startDate: '2026-07-01' },
    });

    await expect(progressStudentToClass(harness.db, INPUT)).rejects.toThrow(
      'STUDENT_PROGRESSION_TARGET_ARCHIVED'
    );
    expect(harness.writes).toEqual([]);
  });

  it('writes nothing when the profile does not exist', async () => {
    // The canonical resolver is the single boundary for "which profile is
    // this", and it already reads the target on every path it can return. So
    // this fails there rather than in a second check progression would own.
    const harness = makeHarness({ profile: null });

    await expect(progressStudentToClass(harness.db, INPUT)).rejects.toThrow(
      'STUDENT_IDENTITY_NOT_FOUND'
    );
    expect(harness.writes).toEqual([]);
  });
});
