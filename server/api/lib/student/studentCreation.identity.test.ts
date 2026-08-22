import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudentWithGeneratedCode } from './studentCreation.js';

vi.mock('@/server/db/documentStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/db/documentStore.js')>()),
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
}));

/**
 * Creation is where a duplicate profile is born, so the order of operations is
 * the contract — not just the outcome. Everything that could refuse the write
 * has to be read before the first write is staged, or the refusal is decided
 * against data the transaction never serialized against.
 *
 * This harness records reads and writes in one ordered log so that order can be
 * asserted directly. Queries are labelled by the fields they filter on, which
 * is enough to tell the four read groups apart.
 */
type Doc = { id: string; data: Record<string, unknown> };

type Filter = [string, string, unknown];

function matches(data: Record<string, unknown>, [field, op, value]: Filter): boolean {
  const actual = data[field];
  if (op === '==') return actual === value;
  if (op === 'in') return Array.isArray(value) && value.includes(actual);
  if (op === '>=') return typeof actual === 'string' && actual >= String(value);
  if (op === '<') return typeof actual === 'string' && actual < String(value);
  return false;
}

function makeHarness(
  options: {
    students?: Doc[];
    counterSeq?: number;
    maintenance?: Record<string, unknown>;
    registry?: Record<string, Record<string, unknown>>;
    aliases?: Record<string, string>;
  } = {}
) {
  const students = options.students ?? [];
  const registry = options.registry ?? {};
  const aliases = options.aliases ?? {};
  const log: string[] = [];
  const writes: Array<{ op: string; path: string; data: unknown }> = [];
  const studentRef = { path: 'students/new-profile', id: 'new-profile' };

  function makeQuery(collection: string) {
    const filters: Filter[] = [];
    const query = {
      __filters: filters,
      __collection: collection,
      where(field: string, op: string, value: unknown) {
        filters.push([field, op, value]);
        return query;
      },
      orderBy() {
        return query;
      },
      limit() {
        return query;
      },
      get() {
        const source = collection === 'students' ? students : [];
        const docs = source.filter((doc) => filters.every((filter) => matches(doc.data, filter)));
        return { empty: docs.length === 0, docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
      },
    };
    return query;
  }

  function docFor(path: string) {
    return { path, id: path.split('/').pop() as string };
  }

  const db = {
    doc: (path: string) => docFor(path),
    collection(name: string) {
      const query = makeQuery(name);
      return {
        ...query,
        doc: (id?: string) => (name === 'students' && !id ? studentRef : docFor(`${name}/${id ?? 'auto'}`)),
      };
    },
    async runTransaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      return callback(tx);
    },
  };

  const tx = {
    async get(target: {
      path?: string;
      __filters?: Filter[];
      __collection?: string;
      get?: () => unknown;
    }) {
      if (target.__filters) {
        log.push(`read:${target.__collection ?? 'query'}(${target.__filters.map((f) => f[0]).join(',')})`);
        return target.get!();
      }
      const path = target.path!;
      log.push(`read:${path}`);
      if (path === '_maintenance/student_identity') {
        return { exists: options.maintenance !== undefined, data: () => options.maintenance };
      }
      if (path.startsWith('student_code_registry/')) {
        const record = registry[path.split('/')[1]];
        return { exists: record !== undefined, data: () => record };
      }
      if (path.startsWith('student_profile_aliases/')) {
        const target_ = aliases[path.split('/')[1]];
        return {
          exists: target_ !== undefined,
          data: () => ({
            legacyProfileId: path.split('/')[1],
            canonicalProfileId: target_,
            mergeRunId: 'run-1',
            reasonCode: 'profile_normalization',
            sourceFingerprint: 'a'.repeat(64),
            createdAt: 't',
            createdBy: 'merge',
          }),
        };
      }
      if (path.startsWith('_counters/')) {
        const seq = options.counterSeq;
        return { exists: seq !== undefined, data: () => ({ seq }) };
      }
      const found = students.find((doc) => path === `students/${doc.id}`);
      return { exists: Boolean(found), data: () => found?.data };
    },
    create(ref: { path: string }, data: unknown) {
      log.push(`write:${ref.path}`);
      writes.push({ op: 'create', path: ref.path, data });
    },
    set(ref: { path: string }, data: unknown) {
      log.push(`write:${ref.path}`);
      writes.push({ op: 'set', path: ref.path, data });
    },
    update(ref: { path: string }, data: unknown) {
      log.push(`write:${ref.path}`);
      writes.push({ op: 'update', path: ref.path, data });
    },
  };

  return { db: db as never, log, writes, studentRef };
}

const HUMAN = {
  name: 'Quách Hoàng Minh',
  dob: '2014-05-02',
  contact: '0900000000',
  classId: 'class-1',
};

const EXISTING = {
  ...HUMAN,
  admissionSearchName: 'quach hoang minh',
  admissionSearchDob: '2014-05-02',
  admissionSearchContact: '84900000000',
  enrollmentStatus: 'active',
};

function build(studentId: string) {
  return { ...HUMAN, studentId, enrollmentStatus: 'active' };
}

const OFFICE = {
  actorId: 'office-1',
  actorRole: 'office',
  mutationOperation: 'student_create' as const,
};

describe('createStudentWithGeneratedCode read/write ordering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T01:00:00.000Z'));
  });

  it('performs every refusing read before the first write', async () => {
    const harness = makeHarness({ counterSeq: 3 });

    await createStudentWithGeneratedCode(harness.db, build, undefined, OFFICE);

    const firstWrite = harness.log.findIndex((entry) => entry.startsWith('write:'));
    const reads = harness.log.slice(0, firstWrite);
    const writes = harness.log.slice(firstWrite);

    expect(reads[0]).toBe('read:_maintenance/student_identity');
    expect(reads[1]).toBe('read:_counters/students_26');
    // Identity conflict, then the code registry and its legacy owner.
    expect(reads).toContain('read:students(admissionSearchName,admissionSearchDob)');
    expect(reads).toContain('read:students(dob)');
    expect(reads).toContain('read:student_code_registry/HS260004');
    expect(reads).toContain('read:students(studentId)');
    expect(writes.every((entry) => entry.startsWith('write:'))).toBe(true);
  });

  it('claims the generated code for the new profile document id', async () => {
    const harness = makeHarness({ counterSeq: 3 });

    const created = await createStudentWithGeneratedCode(harness.db, build, undefined, OFFICE);

    expect(created.studentId).toBe('HS260004');
    expect(harness.writes).toContainEqual(
      expect.objectContaining({
        path: 'student_code_registry/HS260004',
        data: expect.objectContaining({
          canonicalProfileId: 'new-profile',
          isPrimary: true,
          status: 'active',
        }),
      })
    );
  });

  it('writes nothing when maintenance is read_only', async () => {
    const harness = makeHarness({
      counterSeq: 3,
      maintenance: { mode: 'read_only', activeRunId: 'run-1', migrationActorId: 'merge-bot' },
    });

    await expect(
      createStudentWithGeneratedCode(harness.db, build, undefined, OFFICE)
    ).rejects.toThrow('students:create is blocked');
    expect(harness.writes).toEqual([]);
  });

  it('writes nothing when the human already has a profile', async () => {
    const harness = makeHarness({
      counterSeq: 3,
      students: [{ id: 'canonical-1', data: EXISTING }],
    });

    await expect(
      createStudentWithGeneratedCode(harness.db, build, undefined, OFFICE)
    ).rejects.toThrow('STUDENT_IDENTITY_REVIEW_REQUIRED');
    expect(harness.writes).toEqual([]);
  });

  it('writes nothing when the generated code is already owned by another profile', async () => {
    const harness = makeHarness({
      counterSeq: 3,
      registry: {
        HS260004: {
          normalizedCode: 'HS260004',
          canonicalProfileId: 'someone-else',
          isPrimary: true,
          status: 'active',
        },
      },
    });

    await expect(
      createStudentWithGeneratedCode(harness.db, build, undefined, OFFICE)
    ).rejects.toThrow('STUDENT_CODE_ALREADY_CLAIMED');
    expect(harness.writes).toEqual([]);
  });
});

describe('createStudentWithGeneratedCode identity override', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T01:00:00.000Z'));
  });

  const OVERRIDE = {
    decision: 'confirmed_distinct_person' as const,
    candidateProfileIds: ['canonical-1'],
    reason: 'Cousins sharing a household phone; both verified in person.',
  };

  it('creates the profile and stages the override audit in the same transaction', async () => {
    const harness = makeHarness({
      counterSeq: 3,
      students: [{ id: 'canonical-1', data: EXISTING }],
    });

    await createStudentWithGeneratedCode(harness.db, build, undefined, {
      actorId: 'admin-1',
      actorRole: 'admin',
      mutationOperation: 'student_create',
      distinctPersonOverride: OVERRIDE,
    });

    expect(harness.writes).toContainEqual(
      expect.objectContaining({ path: 'students/new-profile' })
    );
    // Staged, not written afterwards: the record of why a second profile was
    // allowed must not be able to go missing while the profile survives.
    const audit = harness.writes.find((write) => write.path.startsWith('audit_logs/'));
    expect(audit?.data).toMatchObject({
      action: 'create',
      collection: 'students',
      metadata: expect.objectContaining({
        decision: 'confirmed_distinct_person',
        candidateProfileIds: ['canonical-1'],
        actorId: 'admin-1',
      }),
    });
  });

  it.each(['student_import', 'trial_create', 'waitlist_create'] as const)(
    'refuses an override supplied by %s even from an admin actor',
    async (mutationOperation) => {
      // These are the paths that produce duplicates in bulk. An override that
      // remained reachable from them would defeat the guard entirely, so the
      // refusal is keyed on the operation rather than on the caller's role.
      const harness = makeHarness({
        counterSeq: 3,
        students: [{ id: 'canonical-1', data: EXISTING }],
      });

      await expect(
        createStudentWithGeneratedCode(harness.db, build, undefined, {
          actorId: 'admin-1',
          actorRole: 'admin',
          mutationOperation,
          distinctPersonOverride: OVERRIDE,
        })
      ).rejects.toThrow('STUDENT_IDENTITY_OVERRIDE_FORBIDDEN');
      expect(harness.writes).toEqual([]);
    }
  );
});
